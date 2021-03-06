require("dotenv").config();

import { debug as debugInit } from "debug";
import { IReleaseGroup } from "musicbrainz-api";
import { join } from "path";
import { fileExists, readJSONFile, writeFile } from "../util/fs";
import { clean } from "./clean";
import {
  discogs,
  DiscogsMaster,
  DiscogsRelease,
  DiscogsReleaseWithRating,
} from "./scrape/discogs";
import { LastFmAlbum, scrapeLastFm as lastFm } from "./scrape/last-fm";
import { musicBrainz } from "./scrape/mb";
import { scrapeSpotify } from "./scrape/spotify";
import { upcCsv } from "./scrape/upc-csv";

const debug = debugInit("music-scraper:init");

debug("HELLO!");

// SETUP data directories
if (typeof process.env.DATA_DIR === "undefined")
  throw "DATA_DIR must be set to a valid directory";

// SETUP library JSON blob
export const LIBRARY_PATH = join(process.env.DATA_DIR, "lib-music.json");

interface SpotifySavedAlbum extends SpotifyApi.AlbumObjectFull {
  addedDate: string;
  audioFeatures: SpotifyApi.AudioFeaturesObject[];
}

export type AlbumId = {
  spotify: string;
  upc?: string;
  rymUrl?: string;
  musicBrainz?: string;
  discogs?: string;
};

interface Album {
  discogs?: {
    master: DiscogsMaster;
    releases?: DiscogsRelease[];
    /** Only top 10 releases will have ratings */
    releasesWithRatings?: DiscogsReleaseWithRating[];
  } | null;
  mb?: { releaseGroup: IReleaseGroup } | null;
  lastFm?: LastFmAlbum | null;
  id: AlbumId;
  spotify: SpotifySavedAlbum;
}

interface Library {
  albums: { [id: string]: Album };
}

export const library: Library = { albums: {} };

export const albumTitle = (a: Album) =>
  `${a.spotify.artists[0].name}-${a.spotify.name}`;

export async function save() {
  await writeFile(LIBRARY_PATH, JSON.stringify(library), undefined, debug);
}

async function init() {
  // Load library
  if (await fileExists(LIBRARY_PATH)) {
    debug(`${LIBRARY_PATH} library file found!\nreading...`);
    let lib = (await readJSONFile(LIBRARY_PATH, debug)) as {
      albums: { [id: string]: SpotifySavedAlbum };
    };

    Object.assign(library, lib);

    debug(`library has ${Object.keys(library.albums).length} albums loaded`);
  }

  await scrapeSpotify();

  await upcCsv();

  await musicBrainz();

  await discogs();

  await lastFm();

  const cleanLibrary = await clean();

  debug("saving cleaned library file");

  await writeFile(
    "/home/nfs/code/movie-browser/public/lib-music.json",
    JSON.stringify(cleanLibrary),
    undefined,
    debug
  );
}

init();
