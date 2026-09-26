using TaikoLabs.Api.Services;

namespace TaikoLabs.Api.Tests;

public class MockModeTests
{
    private static readonly Venue Venue = TestVenues.Create(TestVenues.TaikoLabs());

    [Fact]
    public void Without_video_ids_every_other_cabinet_streams_a_fake_unembeddable_video()
    {
        var snapshot = YouTubeLiveClient.BuildMockSnapshot(Venue, []);

        var stream = Assert.Single(snapshot.Streams);
        Assert.Equal("a1", stream.StationId);
        Assert.False(stream.Embeddable);
        Assert.StartsWith("mock-", stream.VideoId);
    }

    [Fact]
    public void With_video_ids_every_cabinet_streams_one_of_them_embeddable()
    {
        var snapshot = YouTubeLiveClient.BuildMockSnapshot(Venue, ["vidA", "vidB"]);

        Assert.Equal(["a1", "base"], snapshot.Streams.Select(stream => stream.StationId));
        Assert.Equal(["vidA", "vidB"], snapshot.Streams.Select(stream => stream.VideoId));
        Assert.All(snapshot.Streams, stream => Assert.True(stream.Embeddable));
    }
}
