using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;

namespace TaikoLabs.Desktop;

public partial class MainWindow : Window
{
    private readonly DesktopSettings _settings = DesktopSettings.Load();
    private WindowState _stateBeforeFullscreen = WindowState.Normal;
    private bool _isFullscreen;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        PreviewKeyDown += OnPreviewKeyDown;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await InitializeWebViewAsync();
        }
        catch (Exception ex)
        {
            ShowError(
                $"WebView2를 초기화하지 못했습니다.\n\n{ex.Message}\n\n" +
                "WebView2 런타임이 설치되어 있는지 확인해 주세요: https://developer.microsoft.com/microsoft-edge/webview2/");
        }
    }

    private async Task InitializeWebViewAsync()
    {
        // Browsers block unmuted autoplay, so a web multiview always starts silent.
        // The shell can lift that restriction, which is its main advantage.
        var browserArguments = _settings.AllowAutoplayWithSound
            ? "--autoplay-policy=no-user-gesture-required"
            : string.Empty;

        var userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TaikoLabsMultiview",
            "WebView2");

        var environment = await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: userDataFolder,
            options: new CoreWebView2EnvironmentOptions
            {
                AdditionalBrowserArguments = browserArguments,
            });

        await WebView.EnsureCoreWebView2Async(environment);

        var core = WebView.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsSwipeNavigationEnabled = false;

        // Tell the page where the API lives before any of its own script runs.
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            $"window.__TAIKO_API_BASE__ = {JsonSerializer.Serialize(_settings.ApiBaseUrl)};");

        core.NavigationCompleted += OnNavigationCompleted;

        var target = await ResolveStartUrlAsync(core);
        if (target is null)
        {
            return;
        }

        StatusText.Text = target.Description;
        core.Navigate(target.Url);
    }

    private sealed record StartTarget(string Url, string Description);

    private async Task<StartTarget?> ResolveStartUrlAsync(CoreWebView2 core)
    {
        var mode = _settings.FrontendMode;

        if (mode is FrontendMode.DevServer or FrontendMode.Auto)
        {
            var devServerRunning = await IsReachableAsync(_settings.DevServerUrl);

            if (devServerRunning)
            {
                // The dev server proxies /api itself, so the shell's base would only get in the way.
                await core.AddScriptToExecuteOnDocumentCreatedAsync("delete window.__TAIKO_API_BASE__;");
                return new StartTarget(_settings.DevServerUrl, $"개발 서버 · {_settings.DevServerUrl}");
            }

            if (mode == FrontendMode.DevServer)
            {
                ShowError(
                    $"개발 서버에 연결하지 못했습니다: {_settings.DevServerUrl}\n\n" +
                    "frontend 폴더에서 npm run dev 를 먼저 실행해 주세요.");
                return null;
            }
        }

        var distDirectory = _settings.ResolveBuiltFrontendDirectory();
        if (distDirectory is null)
        {
            ShowError(
                "빌드된 프론트엔드를 찾지 못했습니다.\n\n" +
                "frontend 폴더에서 npm run build 를 실행하거나, 개발 서버(npm run dev)를 띄운 뒤 다시 시도해 주세요.");
            return null;
        }

        // Served over http rather than https: the page must be allowed to call the
        // http backend, and Chromium blocks that from an https origin as mixed content.
        core.SetVirtualHostNameToFolderMapping(
            _settings.VirtualHost,
            distDirectory,
            CoreWebView2HostResourceAccessKind.Allow);

        return new StartTarget(
            $"http://{_settings.VirtualHost}/index.html",
            $"빌드 결과 · {distDirectory}");
    }

    private static async Task<bool> IsReachableAsync(string url)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(700) };
            using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            ErrorPanel.Visibility = Visibility.Collapsed;
            return;
        }

        ShowError($"페이지를 여는 데 실패했습니다. ({e.WebErrorStatus})\n\n백엔드와 프론트엔드가 실행 중인지 확인해 주세요.");
    }

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        ErrorPanel.Visibility = Visibility.Visible;
        StatusText.Text = "오류";
    }

    // ------------------------------------------------------------- commands

    private void OnReloadClick(object sender, RoutedEventArgs e) => WebView.CoreWebView2?.Reload();

    private void OnDevToolsClick(object sender, RoutedEventArgs e) => WebView.CoreWebView2?.OpenDevToolsWindow();

    private void OnFullscreenClick(object sender, RoutedEventArgs e) => ToggleFullscreen();

    private void OnPreviewKeyDown(object sender, KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.F5:
                WebView.CoreWebView2?.Reload();
                e.Handled = true;
                break;

            case Key.F11:
                ToggleFullscreen();
                e.Handled = true;
                break;

            case Key.F12:
                WebView.CoreWebView2?.OpenDevToolsWindow();
                e.Handled = true;
                break;

            case Key.Escape when _isFullscreen:
                ToggleFullscreen();
                e.Handled = true;
                break;
        }
    }

    private void ToggleFullscreen()
    {
        if (_isFullscreen)
        {
            WindowStyle = WindowStyle.SingleBorderWindow;
            ResizeMode = ResizeMode.CanResize;
            WindowState = _stateBeforeFullscreen;
            Toolbar.Visibility = Visibility.Visible;
            _isFullscreen = false;
            return;
        }

        _stateBeforeFullscreen = WindowState;
        Toolbar.Visibility = Visibility.Collapsed;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        WindowState = WindowState.Normal; // Forces a re-maximise so the taskbar is covered.
        WindowState = WindowState.Maximized;
        _isFullscreen = true;
    }
}
