using Avalonia.Controls;
using Avalonia.Layout;

namespace TaikoLabs.VenueEditor;

/// <summary>
/// The two message boxes the editor needs. Avalonia ships no MessageBox, and these are
/// small enough that a hand-built window beats another dependency.
/// </summary>
internal static class Dialogs
{
    public static Task ShowAsync(Window owner, string title, string message) =>
        RunAsync(owner, title, message, confirmLabel: "확인", cancelLabel: null);

    /// <summary>True when the user confirmed; false on cancel or closing the window.</summary>
    public static Task<bool> ConfirmAsync(Window owner, string title, string message, string confirmLabel) =>
        RunAsync(owner, title, message, confirmLabel, cancelLabel: "취소");

    private static async Task<bool> RunAsync(
        Window owner,
        string title,
        string message,
        string confirmLabel,
        string? cancelLabel)
    {
        var dialog = new Window
        {
            Title = title,
            Width = 440,
            SizeToContent = SizeToContent.Height,
            CanResize = false,
            ShowInTaskbar = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
        };

        var confirm = new Button { Content = confirmLabel, IsDefault = true, MinWidth = 80 };
        confirm.Click += (_, _) => dialog.Close(true);

        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Spacing = 8,
        };

        if (cancelLabel is not null)
        {
            var cancel = new Button { Content = cancelLabel, IsCancel = true, MinWidth = 80 };
            cancel.Click += (_, _) => dialog.Close(false);
            buttons.Children.Add(cancel);
        }

        buttons.Children.Add(confirm);

        dialog.Content = new StackPanel
        {
            Margin = new Avalonia.Thickness(20),
            Spacing = 16,
            Children =
            {
                new SelectableTextBlock { Text = message, TextWrapping = Avalonia.Media.TextWrapping.Wrap },
                buttons,
            },
        };

        return await dialog.ShowDialog<bool>(owner);
    }
}
