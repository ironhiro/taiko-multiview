using System.Collections.ObjectModel;
using System.IO;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Win32;
using TaikoLabs.VenueEditor.Models;
using TaikoLabs.VenueEditor.Services;

namespace TaikoLabs.VenueEditor;

public partial class MainWindow : Window
{
    private readonly ChannelLookup _lookup = new();
    private readonly ObservableCollection<VenueDraft> _venues = [];
    private readonly ObservableCollection<TitleRow> _titles = [];

    private JsonObject? _root;
    private string? _path;
    private VenueDraft? _current;

    /// <summary>Set while loading a venue into the form, so field events do not write back.</summary>
    private bool _isBinding;

    public MainWindow()
    {
        InitializeComponent();

        VenueList.ItemsSource = _venues;
        TitleGrid.ItemsSource = _titles;

        Loaded += OnLoaded;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        var path = ConfigFile.FindDefaultPath();

        if (path is null)
        {
            SetStatus("appsettings.json을 찾지 못했습니다. [파일 선택]으로 직접 지정해 주세요.");
            return;
        }

        LoadFile(path);
    }

    // ------------------------------------------------------------ file

    private void OnBrowseClick(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "appsettings.json 선택",
            Filter = "JSON 파일 (*.json)|*.json|모든 파일 (*.*)|*.*",
            InitialDirectory = _path is null ? string.Empty : Path.GetDirectoryName(_path) ?? string.Empty,
        };

        if (dialog.ShowDialog(this) == true)
        {
            LoadFile(dialog.FileName);
        }
    }

    private void LoadFile(string path)
    {
        try
        {
            var loaded = ConfigFile.Load(path);

            _root = loaded.Root;
            _path = path;
            PathBox.Text = path;

            _venues.Clear();
            foreach (var venue in loaded.Venues)
            {
                _venues.Add(VenueDraft.WithDefaultHours(venue));
            }

            VenueList.SelectedIndex = _venues.Count > 0 ? 0 : -1;
            SetStatus($"{_venues.Count}개 매장을 불러왔습니다.");
        }
        catch (Exception ex)
        {
            SetStatus($"불러오기 실패: {ex.Message}");
            MessageBox.Show(this, ex.Message, "불러오기 실패", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void OnSaveClick(object sender, RoutedEventArgs e)
    {
        if (_root is null || _path is null)
        {
            SetStatus("먼저 설정 파일을 불러와 주세요.");
            return;
        }

        CommitCurrent();

        // Blocking errors would make the API skip the venue entirely, so stop here.
        var blocking = _venues
            .SelectMany(venue => VenueValidator.Validate(venue, _venues)
                .Where(issue => issue.IsError)
                .Select(issue => $"[{venue.Display}] {issue.Message}"))
            .ToList();

        if (blocking.Count > 0)
        {
            MessageBox.Show(
                this,
                "아래 문제를 고쳐야 저장할 수 있습니다.\n\n" + string.Join("\n", blocking),
                "검증 실패",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);

            EditorTabs.SelectedIndex = 5;
            RefreshIssues();
            return;
        }

        try
        {
            ConfigFile.Save(_path, _root, _venues);
            SetStatus($"{DateTime.Now:HH:mm:ss} 저장 완료 — API를 다시 시작하면 반영됩니다.");
        }
        catch (Exception ex)
        {
            SetStatus($"저장 실패: {ex.Message}");
            MessageBox.Show(this, ex.Message, "저장 실패", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    // ------------------------------------------------------------ venue list

    private void OnVenueSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        CommitCurrent();
        _current = VenueList.SelectedItem as VenueDraft;
        BindCurrent();
    }

    private void OnAddVenueClick(object sender, RoutedEventArgs e)
    {
        CommitCurrent();

        var draft = VenueDraft.CreateNew();
        draft.Stations.Add(new StationDraft { Id = "1", Label = "1번대" });

        _venues.Add(draft);
        VenueList.SelectedItem = draft;
        EditorTabs.SelectedIndex = 0;
        IdBox.Focus();
    }

    private void OnDuplicateVenueClick(object sender, RoutedEventArgs e)
    {
        CommitCurrent();

        if (_current is null)
        {
            return;
        }

        var copy = new VenueDraft
        {
            Id = _current.Id + "-copy",
            Name = _current.Name + " (복사)",
            Accent = _current.Accent,
            ChannelId = _current.ChannelId,
            ChannelUrl = _current.ChannelUrl,
            TitlePattern = _current.TitlePattern,
            NaverPlaceId = _current.NaverPlaceId,
            ClosedDates = _current.ClosedDates,
            // Deliberately not copied: a floor plan belongs to one venue's geometry.
            Layout = null,
        };

        foreach (var zone in _current.Zones)
        {
            copy.Zones.Add(new ZoneDraft { Id = zone.Id, Code = zone.Code, Label = zone.Label });
        }

        foreach (var station in _current.Stations)
        {
            copy.Stations.Add(new StationDraft
            {
                Id = station.Id,
                Label = station.Label,
                ZoneId = station.ZoneId,
                Aliases = station.Aliases,
            });
        }

        foreach (var hour in _current.Hours)
        {
            copy.Hours.Add(new HourDraft(hour.Day) { Open = hour.Open, Close = hour.Close, IsClosed = hour.IsClosed });
        }

        _venues.Add(copy);
        VenueList.SelectedItem = copy;
    }

    private void OnRemoveVenueClick(object sender, RoutedEventArgs e)
    {
        if (_current is null)
        {
            return;
        }

        var answer = MessageBox.Show(
            this,
            $"'{_current.Display}' 매장을 목록에서 제거할까요?\n저장하기 전까지 파일은 바뀌지 않습니다.",
            "매장 삭제",
            MessageBoxButton.OKCancel,
            MessageBoxImage.Question);

        if (answer != MessageBoxResult.OK)
        {
            return;
        }

        var removed = _current;
        _current = null;
        _venues.Remove(removed);
        VenueList.SelectedIndex = _venues.Count > 0 ? 0 : -1;
    }

    // ------------------------------------------------------------ binding

    private void BindCurrent()
    {
        _isBinding = true;

        var venue = _current;
        var hasVenue = venue is not null;

        EditorTabs.IsEnabled = hasVenue;

        IdBox.Text = venue?.Id ?? string.Empty;
        NameBox.Text = venue?.Name ?? string.Empty;
        AccentBox.Text = venue?.Accent ?? string.Empty;
        ChannelIdBox.Text = venue?.ChannelId ?? string.Empty;
        ChannelUrlBox.Text = venue?.ChannelUrl ?? string.Empty;
        NaverBox.Text = venue?.NaverPlaceId ?? string.Empty;
        PatternBox.Text = venue?.TitlePattern ?? string.Empty;
        ClosedDatesBox.Text = venue?.ClosedDates ?? string.Empty;
        ChannelInputBox.Text = string.Empty;

        StationGrid.ItemsSource = venue?.Stations;
        ZoneGrid.ItemsSource = venue?.Zones;
        HourGrid.ItemsSource = venue?.Hours;

        LayoutSummaryText.Text = venue?.LayoutSummary ?? string.Empty;
        UpdateAccentSwatch();

        _titles.Clear();
        _isBinding = false;

        RefreshPatternState();
        RefreshIssues();
    }

    /// <summary>Copies the form back into the draft. Called before anything that reads the list.</summary>
    private void CommitCurrent()
    {
        if (_current is null || _isBinding)
        {
            return;
        }

        _current.Id = IdBox.Text.Trim();
        _current.Name = NameBox.Text.Trim();
        _current.Accent = AccentBox.Text.Trim();
        _current.ChannelId = ChannelIdBox.Text.Trim();
        _current.ChannelUrl = ChannelUrlBox.Text.Trim();
        _current.NaverPlaceId = NaverBox.Text.Trim();
        _current.TitlePattern = PatternBox.Text;
        _current.ClosedDates = ClosedDatesBox.Text;
    }

    private void UpdateAccentSwatch()
    {
        try
        {
            var value = AccentBox.Text.Trim();
            AccentSwatch.Background = value.StartsWith('#')
                ? new SolidColorBrush((Color)ColorConverter.ConvertFromString(value))
                : Brushes.Transparent;
        }
        catch (FormatException)
        {
            AccentSwatch.Background = Brushes.Transparent;
        }
    }

    // ------------------------------------------------------------ channel

    private async void OnResolveChannelClick(object sender, RoutedEventArgs e)
    {
        var input = ChannelInputBox.Text.Trim();
        if (input.Length == 0)
        {
            SetStatus("@핸들이나 채널 URL을 입력해 주세요.");
            return;
        }

        ResolveButton.IsEnabled = false;
        SetStatus("채널을 조회하는 중…");

        try
        {
            var channelId = await _lookup.ResolveChannelIdAsync(input);

            if (channelId is null)
            {
                SetStatus("채널을 찾지 못했습니다. 주소를 다시 확인해 주세요.");
                return;
            }

            ChannelIdBox.Text = channelId;

            if (ChannelUrlBox.Text.Trim().Length == 0)
            {
                ChannelUrlBox.Text = input.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                    ? input
                    : $"https://www.youtube.com/{(input.StartsWith('@') ? input : "@" + input)}";
            }

            var name = await _lookup.FetchChannelNameAsync(channelId);
            if (name is not null && NameBox.Text.Trim().Length == 0)
            {
                NameBox.Text = name;
            }

            CommitCurrent();
            SetStatus($"채널 확인: {name ?? channelId}");
        }
        catch (Exception ex)
        {
            SetStatus($"조회 실패: {ex.Message}");
        }
        finally
        {
            ResolveButton.IsEnabled = true;
        }
    }

    private async void OnFetchTitlesClick(object sender, RoutedEventArgs e)
    {
        CommitCurrent();

        var channelId = ChannelIdBox.Text.Trim();
        if (channelId.Length == 0)
        {
            SetStatus("먼저 채널을 조회해 channelId를 채워 주세요.");
            return;
        }

        FetchButton.IsEnabled = false;
        SetStatus("최근 방송 제목을 가져오는 중…");

        try
        {
            var titles = await _lookup.FetchRecentTitlesAsync(channelId);

            _titles.Clear();
            foreach (var title in titles)
            {
                _titles.Add(new TitleRow(title));
            }

            RefreshPatternState();
            SetStatus($"제목 {titles.Count}건을 가져왔습니다. 매칭 결과를 확인하세요.");
        }
        catch (Exception ex)
        {
            SetStatus($"제목을 가져오지 못했습니다: {ex.Message}");
        }
        finally
        {
            FetchButton.IsEnabled = true;
        }
    }

    private void OnTitleSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TitleGrid.SelectedItem is TitleRow row)
        {
            SampleBox.Text = row.Title;
        }
    }

    // ------------------------------------------------------------ pattern

    private void OnPatternChanged(object sender, TextChangedEventArgs e)
    {
        if (_isBinding)
        {
            return;
        }

        CommitCurrent();
        RefreshPatternState();
    }

    private void OnBuildPatternClick(object sender, RoutedEventArgs e)
    {
        try
        {
            PatternBox.Text = PatternBuilder.FromSelection(
                SampleBox.Text,
                SampleBox.SelectionStart,
                SampleBox.SelectionLength);

            CommitCurrent();
            RefreshPatternState();
            SetStatus("패턴을 만들었습니다. 아래 목록에서 매칭 결과를 확인하세요.");
        }
        catch (ArgumentException ex)
        {
            SetStatus(ex.Message);
        }
    }

    /// <summary>Re-runs the pattern over the fetched titles and shows what each resolves to.</summary>
    private void RefreshPatternState()
    {
        var ok = PatternBuilder.TryCompile(PatternBox.Text, out var regex, out var error);
        PatternError.Text = ok ? string.Empty : error;

        var stations = _current?.Stations ?? [];

        foreach (var row in _titles)
        {
            if (!ok || regex is null)
            {
                row.Update("—", "패턴 오류");
                continue;
            }

            var parsed = TryMatch(regex, row.Title);
            if (parsed is null)
            {
                row.Update("—", "매칭 안 됨");
                continue;
            }

            var station = ResolveStation(parsed, stations);
            row.Update(parsed, station ?? "⚠ 매칭되는 기체 없음");
        }

        RefreshIssues();
    }

    private static string? TryMatch(System.Text.RegularExpressions.Regex regex, string title)
    {
        try
        {
            var match = regex.Match(title);
            return match.Success ? match.Groups["name"].Value.Trim() : null;
        }
        catch (System.Text.RegularExpressions.RegexMatchTimeoutException)
        {
            return null;
        }
    }

    /// <summary>Same normalisation the API uses: ignore case, spaces and separators.</summary>
    private static string? ResolveStation(string name, IEnumerable<StationDraft> stations)
    {
        var key = Normalize(name);

        foreach (var station in stations)
        {
            var candidates = ConfigFile.SplitAliases(station.Aliases)
                .Append(station.Label)
                .Append(station.Id);

            if (candidates.Any(candidate => Normalize(candidate) == key && key.Length > 0))
            {
                return $"{station.Id} ({station.Label})";
            }
        }

        return null;
    }

    private static string Normalize(string value) =>
        new(value.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    // ------------------------------------------------------------ layout

    private void OnClearLayoutClick(object sender, RoutedEventArgs e)
    {
        if (_current is null || _current.Layout is null)
        {
            return;
        }

        var answer = MessageBox.Show(
            this,
            "배치도 좌표를 제거하면 이 매장은 그리드 보기만 제공합니다.\n되돌리려면 좌표를 다시 작성해야 합니다.",
            "배치도 제거",
            MessageBoxButton.OKCancel,
            MessageBoxImage.Warning);

        if (answer != MessageBoxResult.OK)
        {
            return;
        }

        _current.Layout = null;
        LayoutSummaryText.Text = _current.LayoutSummary;
        SetStatus("배치도를 제거했습니다. 저장해야 반영됩니다.");
    }

    // ------------------------------------------------------------ validation

    private void OnValidateClick(object sender, RoutedEventArgs e)
    {
        CommitCurrent();
        RefreshIssues();
    }

    private void RefreshIssues()
    {
        if (_current is null)
        {
            IssueList.ItemsSource = null;
            return;
        }

        var issues = VenueValidator.Validate(_current, _venues);

        IssueList.ItemsSource = issues.Count > 0
            ? issues.Select(issue => issue.ToString()).ToList()
            : new List<string> { "✔ 문제 없습니다." };
    }

    private void SetStatus(string message) => StatusText.Text = message;

    /// <summary>A fetched title plus what the current pattern makes of it.</summary>
    private sealed class TitleRow(string title) : Observable
    {
        private string _name = "—";
        private string _station = "—";

        public string Title { get; } = title;

        public string Name { get => _name; private set => Set(ref _name, value); }

        public string Station { get => _station; private set => Set(ref _station, value); }

        public void Update(string name, string station)
        {
            Name = name;
            Station = station;
        }
    }
}
