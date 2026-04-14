"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  FileInput,
  HelperText,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeadCell,
  TableRow,
  TextInput,
} from "flowbite-react";
import {
  DEFAULT_HG_FORMULA,
  DEFAULT_PG_FORMULA,
  type FormulaConfig,
} from "@/lib/scoring/types";

type ScoreResponse = {
  archive: {
    taskFileName: string;
    igcFileNames: string[];
  };
  taskDefinition?: Array<{
    index: number;
    label: string;
    name?: string;
    radiusMeters?: number;
    legDistanceKm?: number;
    cumulativeDistanceKm?: number;
    coordinates?: string;
    altitudeMeters?: number;
  }>;
  taskStatistics?: Array<{
    param: string;
    value: string | number | boolean;
  }>;
  formulaSettings?: Array<{
    param: string;
    value: string | number | boolean;
  }>;
  task: {
    waypoints: number;
    startTimes: number[];
    essDistance: number;
    goalLegDistance: number;
    taskStartTime: number;
    taskFinishTime: number;
  };
  modality: "PG" | "HG";
  result: {
    formula: FormulaConfig;
    quality: {
      launch: number;
      distance: number;
      time: number;
      overall: number;
    };
    totals: {
      pilots: number;
      launched: number;
      goal: number;
      ess: number;
      maxDist: number;
      fastest: number;
    };
    scores: Array<{
      name: string;
      distance: number;
      distancePoints: number;
      speedPoints: number;
      leadingPoints: number;
      arrivalPoints: number;
      total: number;
      esTime: number;
      ssTime: number;
      time: number;
      place: number;
      goalMade: boolean;
    }>;
  };
};

const FORMULA_STORAGE_KEY = "gap-scoring-formula-overrides-v1";

type SelectFieldOption = {
  label: string;
  value: string;
};

type FormulaField = {
  key: keyof FormulaConfig;
  label: string;
  type: "number" | "select";
  step?: string;
  min?: number;
  options?: SelectFieldOption[];
};

const FORMULA_FIELDS: FormulaField[] = [
  {
    key: "class",
    label: "Formula class",
    type: "select",
    options: [
      { label: "GAP", value: "gap" },
      { label: "PWC", value: "pwc" },
      { label: "OZGAP", value: "ozgap" },
      { label: "GGAP", value: "ggap" },
    ],
  },
  { key: "version", label: "Version", type: "number", step: "1", min: 0 },
  {
    key: "aircraftClass",
    label: "Aircraft class",
    type: "select",
    options: [
      { label: "PG", value: "PG" },
      { label: "HG", value: "HG" },
    ],
  },
  { key: "nominalLaunch", label: "Nominal launch", type: "number", step: "0.01", min: 0 },
  { key: "nominalDistance", label: "Nominal distance (m)", type: "number", step: "1", min: 0 },
  { key: "nominalTime", label: "Nominal time (s)", type: "number", step: "1", min: 0 },
  { key: "nominalGoal", label: "Nominal goal", type: "number", step: "0.01", min: 0 },
  { key: "minDist", label: "Minimum distance (m)", type: "number", step: "1", min: 0 },
  { key: "leadingTimeRatio", label: "Leading time ratio", type: "number", step: "0.001", min: 0 },
  {
    key: "weightDist",
    label: "Distance weight",
    type: "select",
    options: [
      { label: "Pre-2014", value: "pre2014" },
      { label: "Post-2014", value: "post2014" },
    ],
  },
  { key: "linearDist", label: "Linear distance fraction", type: "number", step: "0.01", min: 0 },
  {
    key: "diffCalc",
    label: "Difficulty calculation",
    type: "select",
    options: [
      { label: "Landed out only", value: "lo" },
      { label: "All", value: "all" },
    ],
  },
  { key: "diffDist", label: "Difficulty lookahead", type: "number", step: "1", min: 0 },
  {
    key: "diffRamp",
    label: "Difficulty ramp",
    type: "select",
    options: [
      { label: "Fixed", value: "fixed" },
      { label: "Flexible", value: "flexible" },
    ],
  },
  {
    key: "speedCalc",
    label: "Speed calculation",
    type: "select",
    options: [
      { label: "Normal", value: "normal" },
      { label: "Extended", value: "extended" },
    ],
  },
  {
    key: "arrival",
    label: "Arrival scoring",
    type: "select",
    options: [
      { label: "Off", value: "off" },
      { label: "Place", value: "place" },
      { label: "Timed", value: "timed" },
    ],
  },
  {
    key: "departure",
    label: "Departure scoring",
    type: "select",
    options: [
      { label: "Leadout", value: "leadout" },
      { label: "Off", value: "off" },
    ],
  },
];

function getDefaultFormula(modality: "PG" | "HG"): FormulaConfig {
  return modality === "HG" ? { ...DEFAULT_HG_FORMULA } : { ...DEFAULT_PG_FORMULA };
}

function loadStoredFormulaMap(): Partial<Record<"PG" | "HG", FormulaConfig>> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(FORMULA_STORAGE_KEY);
    if (!stored) {
      return {};
    }

    return JSON.parse(stored) as Partial<Record<"PG" | "HG", FormulaConfig>>;
  } catch {
    return {};
  }
}

function saveStoredFormulaMap(value: Partial<Record<"PG" | "HG", FormulaConfig>>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(FORMULA_STORAGE_KEY, JSON.stringify(value));
}

function formatClockTime(unixSeconds: number): string {
  if (unixSeconds <= 0) {
    return "—";
  }

  return new Date(unixSeconds * 1000).toISOString().slice(11, 19);
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return "—";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatScore(value: number): string {
  return value.toFixed(1);
}

function formatMetaValue(param: string, value: string | number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }

  if (typeof value === "number") {
    if (param.includes("time") && Number.isInteger(value) && value > 100) {
      return formatDuration(value);
    }
    return String(value);
  }

  return value;
}

export function ScoringDashboard() {
  const [archive, setArchive] = useState<File | null>(null);
  const [modality, setModality] = useState<"PG" | "HG">("PG");
  const [pilotsDidNotFly, setPilotsDidNotFly] = useState("0");
  const [formulaDraft, setFormulaDraft] = useState<FormulaConfig>(() => getDefaultFormula("PG"));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const summaryCards = useMemo(() => {
    if (!result) {
      return [];
    }

    return [
      {
        label: "Pilots",
        value: `${result.result.totals.launched}/${result.result.totals.pilots}`,
      },
      {
        label: "Goal",
        value: `${result.result.totals.goal}`,
      },
      {
        label: "ESS",
        value: `${result.result.totals.ess}`,
      },
      {
        label: "Quality",
        value: result.result.quality.overall.toFixed(3),
      },
    ];
  }, [result]);

  useEffect(() => {
    const storedMap = loadStoredFormulaMap();
    setFormulaDraft(storedMap[modality] ?? getDefaultFormula(modality));
  }, [modality]);

  useEffect(() => {
    const storedMap = loadStoredFormulaMap();
    saveStoredFormulaMap({
      ...storedMap,
      [modality]: formulaDraft,
    });
  }, [formulaDraft, modality]);

  function updateFormulaField<K extends keyof FormulaConfig>(key: K, value: FormulaConfig[K]) {
    setFormulaDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleResetFormula() {
    if (!window.confirm(`Reset GAP parameters for ${modality} to defaults?`)) {
      return;
    }

    const nextFormula = getDefaultFormula(modality);
    setFormulaDraft(nextFormula);

    const storedMap = loadStoredFormulaMap();
    delete storedMap[modality];
    saveStoredFormulaMap(storedMap);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!archive) {
      setError("Choose a zip archive with one task and at least one IGC file.");
      return;
    }

    const formData = new FormData();
    formData.set("archive", archive);
    formData.set("modality", modality);
    formData.set("pilotsDidNotFly", pilotsDidNotFly);
    formData.set("formulaOverrides", JSON.stringify(formulaDraft));

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/score", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as ScoreResponse | { error?: string };
      if (!response.ok) {
        throw new Error("error" in payload && payload.error ? payload.error : "Scoring request failed.");
      }

      setResult(payload as ScoreResponse);
    } catch (submissionError) {
      setResult(null);
      setError(
        submissionError instanceof Error ? submissionError.message : "Scoring request failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <section className="grid gap-6 rounded-lg border border-slate-200 bg-white p-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Badge color="warning" className="w-fit">
            GAP scoring tool
          </Badge>
          <div className="space-y-2">
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Upload one zip file and score the task on the server.
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              The archive must contain exactly one <code>.xctsk</code> task file and one or more <code>.igc</code> tracks.
              The interface only uploads the archive and displays the result.
            </p>
          </div>
        </div>

        <Card className="rounded-lg border border-slate-200 bg-white shadow-none">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="archive">Competition zip</Label>
              <FileInput
                id="archive"
                accept=".zip,application/zip"
                sizing="md"
                onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
              />
              <HelperText>
                Nested folders are fine. The backend scans the full archive.
              </HelperText>
            </div>

            <div className="space-y-2">
              <Label htmlFor="modality">Aircraft class</Label>
              <Select
                id="modality"
                value={modality}
                onChange={(event) => setModality(event.target.value === "HG" ? "HG" : "PG")}
              >
                <option value="PG">Paragliding (PG)</option>
                <option value="HG">Hang gliding (HG)</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pilots-did-not-fly">Pilots that didn&apos;t fly</Label>
              <TextInput
                id="pilots-did-not-fly"
                type="number"
                min={0}
                inputMode="numeric"
                value={pilotsDidNotFly}
                onChange={(event) => setPilotsDidNotFly(event.target.value)}
              />
              <HelperText>
                Added to the uploaded IGC count for GAP quality.
              </HelperText>
            </div>

            <Button
              type="submit"
              color="warning"
              className="w-full"
              disabled={isSubmitting}
            >
              <span className="inline-flex items-center gap-2">
                {isSubmitting ? <Spinner size="sm" /> : null}
                {isSubmitting ? "Scoring archive" : "Score archive"}
              </span>
            </Button>

            <Button
              type="button"
              color="light"
              className="w-full"
              onClick={() => setShowAdvanced(true)}
            >
              Advanced
            </Button>
          </form>
        </Card>
      </section>

      {error ? (
        <Alert color="failure">
          <span className="font-medium">Scoring failed.</span> {error}
        </Alert>
      ) : null}

      {isSubmitting ? (
        <Card className="rounded-lg border border-slate-200 bg-white shadow-none">
          <div className="flex items-center gap-3 text-sm text-slate-700">
            <Spinner size="md" />
            <span>The backend is unpacking the archive and running GAP scoring.</span>
          </div>
        </Card>
      ) : null}

      {result ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map((card) => (
              <Card key={card.label} className="rounded-lg border border-slate-200 bg-white shadow-none">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{card.value}</p>
              </Card>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <Card className="rounded-lg border border-slate-200 bg-white shadow-none">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-950">Task summary</h2>
                  <Badge color={result.modality === "HG" ? "purple" : "warning"}>
                    {result.modality}
                  </Badge>
                </div>
                <dl className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Task file</dt>
                    <dd className="font-medium text-slate-950">{result.archive.taskFileName}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">IGC files</dt>
                    <dd className="font-medium text-slate-950">{result.archive.igcFileNames.length}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Pilots present</dt>
                    <dd className="font-medium text-slate-950">{result.result.totals.pilots}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Waypoints</dt>
                    <dd className="font-medium text-slate-950">{result.task.waypoints}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">ESS distance</dt>
                    <dd className="font-medium text-slate-950">{formatDistance(result.task.essDistance)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Goal leg</dt>
                    <dd className="font-medium text-slate-950">{formatDistance(result.task.goalLegDistance)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Best time</dt>
                    <dd className="font-medium text-slate-950">{formatDuration(result.result.totals.fastest)}</dd>
                  </div>
                </dl>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Start gates</p>
                  <p className="mt-1 text-sm text-slate-900">
                    {result.task.startTimes.map(formatClockTime).join(" · ")}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="rounded-lg border border-slate-200 bg-white shadow-none">
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-slate-950">Day quality</h2>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <dt className="text-sm text-slate-500">Launch</dt>
                    <dd className="mt-1 text-2xl font-semibold text-slate-950">
                      {result.result.quality.launch.toFixed(3)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <dt className="text-sm text-slate-500">Distance</dt>
                    <dd className="mt-1 text-2xl font-semibold text-slate-950">
                      {result.result.quality.distance.toFixed(3)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <dt className="text-sm text-slate-500">Time</dt>
                    <dd className="mt-1 text-2xl font-semibold text-slate-950">
                      {result.result.quality.time.toFixed(3)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-slate-900 bg-slate-900 p-3 text-white">
                    <dt className="text-sm text-slate-300">Overall</dt>
                    <dd className="mt-1 text-2xl font-semibold">
                      {result.result.quality.overall.toFixed(3)}
                    </dd>
                  </div>
                </dl>
              </div>
            </Card>
          </section>

          <Card className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-none">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Results</h2>
                <p className="text-sm text-slate-500">Sorted by total score.</p>
              </div>
              <Badge color="info">{result.result.scores.length} scored</Badge>
            </div>
            <div className="overflow-x-auto">
              <Table hoverable>
                <TableHead>
                  <TableHeadCell>#</TableHeadCell>
                  <TableHeadCell>Pilot</TableHeadCell>
                  <TableHeadCell>Start</TableHeadCell>
                  <TableHeadCell>Distance</TableHeadCell>
                  <TableHeadCell>Goal</TableHeadCell>
                  <TableHeadCell>Time</TableHeadCell>
                  <TableHeadCell>Dist</TableHeadCell>
                  <TableHeadCell>Speed</TableHeadCell>
                  <TableHeadCell>Lead</TableHeadCell>
                  <TableHeadCell>Total</TableHeadCell>
                </TableHead>
                <TableBody className="divide-y">
                  {result.result.scores.map((score, index) => (
                    <TableRow key={`${score.name}-${index}`} className="bg-white">
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-medium text-slate-950">{score.name}</TableCell>
                      <TableCell>{formatClockTime(score.ssTime)}</TableCell>
                      <TableCell>{formatDistance(score.distance)}</TableCell>
                      <TableCell>{score.goalMade ? "Yes" : "No"}</TableCell>
                      <TableCell>{formatDuration(score.time)}</TableCell>
                      <TableCell>{formatScore(score.distancePoints)}</TableCell>
                      <TableCell>{formatScore(score.speedPoints)}</TableCell>
                      <TableCell>{formatScore(score.leadingPoints)}</TableCell>
                      <TableCell className="font-semibold text-slate-950">{formatScore(score.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {result.taskDefinition && result.taskDefinition.length > 0 ? (
            <Card className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-none">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-950">Task Definition</h2>
              </div>
              <div className="overflow-x-auto">
                <Table hoverable>
                  <TableHead>
                    <TableHeadCell>No</TableHeadCell>
                    <TableHeadCell>Name</TableHeadCell>
                    <TableHeadCell>Radius</TableHeadCell>
                    <TableHeadCell>Leg Dist.</TableHeadCell>
                    <TableHeadCell>Total Dist.</TableHeadCell>
                    <TableHeadCell>Coordinates</TableHeadCell>
                    <TableHeadCell>Altitude</TableHeadCell>
                  </TableHead>
                  <TableBody className="divide-y">
                    {result.taskDefinition.map((row) => (
                      <TableRow key={`${row.index}-${row.label}`} className="bg-white">
                        <TableCell>{row.label}</TableCell>
                        <TableCell className="font-medium text-slate-950">{row.name ?? "—"}</TableCell>
                        <TableCell>{row.radiusMeters ? `${row.radiusMeters} m` : "—"}</TableCell>
                        <TableCell>{row.legDistanceKm !== undefined ? `${row.legDistanceKm.toFixed(3)} km` : "—"}</TableCell>
                        <TableCell>{row.cumulativeDistanceKm !== undefined ? `${row.cumulativeDistanceKm.toFixed(3)} km` : "—"}</TableCell>
                        <TableCell>{row.coordinates ?? "—"}</TableCell>
                        <TableCell>{row.altitudeMeters !== undefined ? `${row.altitudeMeters} m` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          ) : null}

          {result.taskStatistics && result.taskStatistics.length > 0 ? (
            <Card className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-none">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-950">Task Statistics</h2>
              </div>
              <div className="overflow-x-auto">
                <Table hoverable>
                  <TableHead>
                    <TableHeadCell>param</TableHeadCell>
                    <TableHeadCell>value</TableHeadCell>
                  </TableHead>
                  <TableBody className="divide-y">
                    {result.taskStatistics.map((row) => (
                      <TableRow key={row.param} className="bg-white">
                        <TableCell className="font-mono text-slate-700">{row.param}</TableCell>
                        <TableCell>{formatMetaValue(row.param, row.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          ) : null}

          {result.formulaSettings && result.formulaSettings.length > 0 ? (
            <Card className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-none">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-950">Scoring Formula Settings</h2>
              </div>
              <div className="overflow-x-auto">
                <Table hoverable>
                  <TableHead>
                    <TableHeadCell>param</TableHeadCell>
                    <TableHeadCell>value</TableHeadCell>
                  </TableHead>
                  <TableBody className="divide-y">
                    {result.formulaSettings.map((row) => (
                      <TableRow key={row.param} className="bg-white">
                        <TableCell className="font-mono text-slate-700">{row.param}</TableCell>
                        <TableCell>{formatMetaValue(row.param, row.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      <Modal show={showAdvanced} size="4xl" dismissible onClose={() => setShowAdvanced(false)}>
        <ModalHeader>Advanced GAP Parameters</ModalHeader>
        <ModalBody>
          <div className="grid gap-4 sm:grid-cols-2">
            {FORMULA_FIELDS.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={`formula-${field.key}`}>{field.label}</Label>
                {field.type === "select" ? (
                  <Select
                    id={`formula-${field.key}`}
                    value={String(formulaDraft[field.key])}
                    onChange={(event) =>
                      updateFormulaField(
                        field.key,
                        event.target.value as FormulaConfig[typeof field.key],
                      )
                    }
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    id={`formula-${field.key}`}
                    type="number"
                    min={field.min}
                    step={field.step}
                    value={String(formulaDraft[field.key])}
                    onChange={(event) =>
                      updateFormulaField(
                        field.key,
                        Number(event.target.value) as FormulaConfig[typeof field.key],
                      )
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </ModalBody>
        <ModalFooter className="justify-between">
          <Button color="light" onClick={handleResetFormula}>
            Reset
          </Button>
          <div className="flex gap-2">
            <Button color="light" onClick={() => setShowAdvanced(false)}>
              Close
            </Button>
            <Button color="warning" onClick={() => setShowAdvanced(false)}>
              Done
            </Button>
          </div>
        </ModalFooter>
      </Modal>
    </div>
  );
}
