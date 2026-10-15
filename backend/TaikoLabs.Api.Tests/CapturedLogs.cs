using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace TaikoLabs.Api.Tests;

internal sealed record LogEntry(string Category, LogLevel Level, string Text, IReadOnlyDictionary<string, object?> Properties);

/// <summary>Every log line the app writes, for tests that check what it logged.</summary>
internal sealed class CapturedLogs : ILoggerProvider
{
    private readonly ConcurrentQueue<LogEntry> _entries = new();

    public IReadOnlyList<LogEntry> All => [.. _entries];

    public ILogger CreateLogger(string categoryName) => new Logger(categoryName, _entries);

    public void Dispose()
    {
    }

    private sealed class Logger(string category, ConcurrentQueue<LogEntry> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var properties = state is IEnumerable<KeyValuePair<string, object?>> pairs
                ? pairs.ToDictionary(pair => pair.Key, pair => pair.Value)
                : [];
            entries.Enqueue(new LogEntry(category, logLevel, formatter(state, exception), properties));
        }
    }
}
