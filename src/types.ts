export type ItemStatus =
  | "queued"
  | "fetching"
  | "fallback"
  | "building"
  | "saved"
  | "duplicate"
  | "failed";

export type AttemptKind = "save" | "retry" | "refetch";

export interface ItemRecord {
  id: string;
  submittedUrl: string;
  canonicalUrl: string | null;
  status: ItemStatus;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  sourceDomain: string | null;
  sourceUrl: string | null;
  fallbackUrl: string | null;
  contentHash: string | null;
  unread: boolean;
  queued: boolean;
  calibreBookId: number | null;
  calibreBookPath: string | null;
  lastError: string | null;
  duplicateOfItemId: string | null;
  createdAt: string;
  updatedAt: string;
  lastAttemptedAt: string | null;
  lastSavedAt: string | null;
  lastRefetchedAt: string | null;
  refetchCount: number;
}

export interface ItemAttemptRecord {
  id: string;
  itemId: string;
  attemptKind: AttemptKind;
  status: string;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ItemDetailRecord {
  item: ItemRecord;
  attempts: ItemAttemptRecord[];
}

export interface SaveRequest {
  url: string;
  token: string;
  forceRefetch?: boolean;
}

export interface SaveResponse {
  id: string;
  status: ItemStatus | "unauthorized";
  duplicateOf?: string;
  message: string;
}

export interface ArticleAsset {
  id: string;
  href: string;
  mediaType: string;
  bytes: Uint8Array;
  sourceUrl: string;
}

export interface ExtractedArticle {
  canonicalUrl: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  sourceDomain: string;
  sourceUrl: string;
  fallbackUrl: string | null;
  leadImageUrl: string | null;
  contentHtml: string;
  assets: ArticleAsset[];
}

export interface BuiltEpub {
  tmpPath: string;
  contentHash: string;
  title: string;
}
