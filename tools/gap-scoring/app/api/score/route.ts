import JSZip from "jszip";
import { NextResponse } from "next/server";
import { scoreArchive, type ArchiveFile } from "@/lib/scoring/scoreArchive";
import type { AircraftClass, FormulaConfig } from "@/lib/scoring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DEBUG = process.env.DEBUG === "1";

function isArchiveFile(value: FormDataEntryValue | null): value is File {
    return value instanceof File;
}

function isIgnoredArchiveEntry(name: string): boolean {
    const normalized = name.replace(/\\/g, "/");
    const segments = normalized.split("/");
    const basename = segments[segments.length - 1] ?? normalized;

    return normalized.startsWith("__MACOSX/") ||
        basename.startsWith("._") ||
        basename === ".DS_Store";
}

function getArchiveEntries(zip: JSZip): ArchiveFile[] {
    return Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .filter((entry) => !isIgnoredArchiveEntry(entry.name))
        .map((entry) => ({
            name: entry.name,
            content: "",
        }));
}

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const archive = formData.get("archive");
        const modalityValue = formData.get("modality");
        const didNotFlyValue = formData.get("pilotsDidNotFly");
        const formulaOverridesValue = formData.get("formulaOverrides");
        const modality: AircraftClass = modalityValue === "HG" ? "HG" : "PG";
        const pilotsDidNotFly = typeof didNotFlyValue === "string"
            ? Math.max(0, Number.parseInt(didNotFlyValue, 10) || 0)
            : 0;
        let formulaOverrides: Partial<FormulaConfig> | undefined;

        if (typeof formulaOverridesValue === "string" && formulaOverridesValue.trim()) {
            try {
                formulaOverrides = JSON.parse(formulaOverridesValue) as Partial<FormulaConfig>;
            } catch {
                return NextResponse.json(
                    { error: "Invalid formulaOverrides payload." },
                    { status: 400 },
                );
            }
        }

        if (!isArchiveFile(archive)) {
            return NextResponse.json(
                { error: "Upload a single zip archive in the archive field." },
                { status: 400 },
            );
        }

        const zip = await JSZip.loadAsync(await archive.arrayBuffer());
        const fileEntries = getArchiveEntries(zip);
        if (DEBUG) {
            console.log("[gap-scoring] zip entries:", fileEntries.map((entry) => entry.name));
        }

        const taskEntries = fileEntries.filter((entry) => entry.name.toLowerCase().endsWith(".xctsk"));
        const igcEntries = fileEntries.filter((entry) => entry.name.toLowerCase().endsWith(".igc"));
        if (DEBUG) {
            console.log("[gap-scoring] task entries:", taskEntries.map((entry) => entry.name));
            console.log("[gap-scoring] igc entries:", igcEntries.map((entry) => entry.name));
        }

        if (taskEntries.length !== 1) {
            return NextResponse.json(
                { error: `Expected exactly one .xctsk file in the zip, found ${taskEntries.length}.` },
                { status: 400 },
            );
        }

        if (igcEntries.length === 0) {
            return NextResponse.json(
                { error: "No .igc files were found in the zip archive." },
                { status: 400 },
            );
        }

        const taskFile: ArchiveFile = {
            name: taskEntries[0].name,
            content: await zip.file(taskEntries[0].name)!.async("string"),
        };

        const igcFiles: ArchiveFile[] = await Promise.all(
            igcEntries.map(async (entry) => ({
                name: entry.name,
                content: await zip.file(entry.name)!.async("string"),
            })),
        );

        const result = scoreArchive({
            taskFile,
            igcFiles,
            modality,
            pilotsPresent: igcFiles.length + pilotsDidNotFly,
            formulaOverrides,
        });

        return NextResponse.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected scoring error.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
