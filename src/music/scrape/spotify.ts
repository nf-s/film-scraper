import Bottleneck from "bottleneck";
import { debug as debugInit } from "debug";
import SpotifyWebApi from "spotify-web-api-node";
import { library, save } from "..";
const debug = debugInit("music-scraper:spotify");

export async function scrapeSpotify() {
  if (process.env.SPOTIFY_TOKEN) {
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(process.env.SPOTIFY_TOKEN);

    debug(`connected to spotify`);

    const spotifyLimiter = new Bottleneck({
      maxConcurrent: 1,
      minTime: 1000,
    });

    let newAlbums = 0;

    await new Promise((resolve, reject) => {
      const getAlbums = async (offset = 0, limit = 50) => {
        spotifyLimiter.schedule(async () => {
          debug(`fetching spotify albums offset=${offset}`);
          try {
            const response = await spotifyApi.getMySavedAlbums({
              limit,
              offset,
            });

            response.body.items.forEach((savedAlbum) => {
              if (!library.albums[savedAlbum.album.id]) {
                newAlbums += 1;
                library.albums[savedAlbum.album.id] = {
                  id: {
                    spotify: savedAlbum.album.id,
                    upc: savedAlbum.album.external_ids.upc,
                  },
                  spotify: {
                    addedDate: savedAlbum.added_at,
                    ...savedAlbum.album,
                    audioFeatures: [],
                  },
                };
              }
            });
            const nextOffset = response.body.next
              ?.match(/offset=([0-9]+)/g)?.[0]
              ?.split("=")?.[1];
            if (nextOffset) {
              getAlbums(parseInt(nextOffset));
            } else {
              debug(`FINISHED fetching spotify albums`);
              resolve("done");
            }
          } catch (error) {
            debug(`FAILED to fetched spotify albums offset=${offset}`);
            debug(error);
            reject();
          }
        });
      };

      getAlbums();
    });

    debug(`imported ${newAlbums} new albums from spotify`);
    debug(
      `library has ${
        Object.keys(library.albums).length
      } total albums from spotify`
    );

    await save();

    // Get audio features

    // Flat array of track IDs
    const trackIds = Object.values(library.albums)
      .filter((album) => album.spotify.audioFeatures === undefined)
      .reduce<string[][]>((tracks, album) => {
        album.spotify.audioFeatures = [];
        tracks.push(
          ...album.spotify.tracks.items.map((t) => [album.spotify.id, t.id])
        );
        return tracks;
      }, []);

    const numBatches = Math.ceil(trackIds.length / 100);

    const tracksBatch = new Array(numBatches)
      .fill(0)
      .map((v, index) => trackIds.slice(index * 100, (index + 1) * 100));

    await Promise.all(
      tracksBatch.map((batch, i) =>
        spotifyLimiter.schedule(async () => {
          debug(`fetching spotify track audo features offset=${i * 100}`);
          const audioFeatures = await spotifyApi.getAudioFeaturesForTracks(
            batch.map(([albumId, trackId]) => trackId)
          );
          audioFeatures.body.audio_features.forEach((track) => {
            const albumId = batch.find(
              ([albumId, trackId]) => track.id === trackId
            )?.[0];
            if (albumId) {
              library.albums[albumId].spotify.audioFeatures.push(track);
            }
          });
        })
      )
    );

    await save();
  } else {
    debug(`WARNING no SPOTIFY_TOKEN provided`);
  }
}
