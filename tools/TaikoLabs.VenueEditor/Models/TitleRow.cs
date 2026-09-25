namespace TaikoLabs.VenueEditor.Models;

/// <summary>A fetched title plus what the current pattern makes of it.</summary>
public sealed class TitleRow(string title) : Observable
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
