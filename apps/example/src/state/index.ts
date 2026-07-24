import type {
  AvailabilityResponse,
  DetailsResponse,
  MediaSummary,
  SearchResponse,
  TorrentResponse,
} from "../api";

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; response: SearchResponse }
  | { status: "empty"; response: SearchResponse }
  | { status: "error"; message: string };

export type DetailsState =
  | { status: "idle" }
  | { status: "loading"; item: MediaSummary }
  | { status: "success"; item: MediaSummary; response: DetailsResponse }
  | { status: "empty"; item: MediaSummary }
  | { status: "error"; item?: MediaSummary; message: string };

export type AvailabilityState =
  | { status: "idle" }
  | { status: "loading"; item: MediaSummary }
  | { status: "success"; item: MediaSummary; response: AvailabilityResponse }
  | { status: "empty"; item: MediaSummary; response: AvailabilityResponse }
  | { status: "error"; item?: MediaSummary; message: string };

export type AvailabilityOption = AvailabilityResponse["options"][number];

export type TorrentState =
  | { status: "idle" }
  | { status: "loading"; item: MediaSummary }
  | { status: "success"; item: MediaSummary; response: TorrentResponse }
  | { status: "empty"; item: MediaSummary; response: TorrentResponse }
  | { status: "error"; item?: MediaSummary; message: string };
