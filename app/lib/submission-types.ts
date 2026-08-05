export type SubmissionStatus = "pending" | "published" | "rejected";

export type SubmissionSummary = {
  id: string;
  status: SubmissionStatus;
  traceFilename: string;
  metadataFilename: string | null;
  traceBytes: number;
  rowCount: number;
  gpuIds: string[];
  headers: string[];
  runId: string | null;
  model: string | null;
  modelFamily: string | null;
  method: string | null;
  gpuType: string | null;
  gpuCount: string | null;
  publicConsent: boolean;
  createdAt: string;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  isOwner?: boolean;
};

export type SubmissionListResponse = {
  submissions: SubmissionSummary[];
  viewer: {
    signedIn: boolean;
    isAdmin: boolean;
  };
};
