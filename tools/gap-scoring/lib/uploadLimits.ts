export const MAX_ARCHIVE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_ARCHIVE_UPLOAD_LABEL = "10 MB";

export function formatUploadSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    const kilobytes = bytes / 1024;
    if (kilobytes < 1024) {
        return `${kilobytes.toFixed(1)} KB`;
    }

    const megabytes = kilobytes / 1024;
    return `${megabytes.toFixed(1)} MB`;
}
