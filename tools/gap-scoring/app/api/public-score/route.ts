import { NextResponse } from "next/server";
import { z } from "zod";
import { scoreJsonTracks } from "@/lib/scoring/scoreJson";
import type { FormulaConfig } from "@/lib/scoring/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pointSchema = z.object({
    lat: z.number().finite().min(-90).max(90),
    lon: z.number().finite().min(-180).max(180),
    alt: z.number().finite(),
    time: z.number().int().nonnegative(),
});

const trackSchema = z.object({
    pilot_name: z.string().trim().min(1),
    pilot_id: z.string().trim().min(1),
    points: z.array(pointSchema).min(1),
});

const timeGateSchema = z.string()
    .trim()
    .regex(/^\d{2}:\d{2}(?::\d{2})?Z?$/, "Expected HH:MM, HH:MM:SS, HH:MMZ, or HH:MM:SSZ.");

const turnpointSchema = z.object({
    waypoint: z.object({
        name: z.string(),
        description: z.string(),
        lat: z.number().finite().min(-90).max(90),
        lon: z.number().finite().min(-180).max(180),
        altSmoothed: z.number().finite(),
    }),
    radius: z.number().finite().positive(),
    type: z.string(),
});

const taskSchema = z.object({
    turnpoints: z.array(turnpointSchema).min(4, "Task must include at least takeoff, SSS, ESS, and goal turnpoints."),
    sss: z.object({
        type: z.string(),
        direction: z.string(),
        timeGates: z.array(timeGateSchema).min(1),
    }),
    goal: z.object({
        type: z.enum(["LINE", "CYLINDER"]),
    }).optional(),
});

const formulaOverridesSchema = z.object({
    nominalLaunch: z.number().finite().positive().optional(),
    nominalDistance: z.number().finite().positive().optional(),
    nominalTime: z.number().finite().positive().optional(),
    nominalGoal: z.number().finite().positive().optional(),
    minDist: z.number().finite().nonnegative().optional(),
    leadingTimeRatio: z.number().finite().nonnegative().optional(),
    weightDist: z.enum(["pre2014", "post2014"]).optional(),
    linearDist: z.number().finite().nonnegative().optional(),
    diffCalc: z.enum(["lo", "all"]).optional(),
    diffDist: z.number().finite().nonnegative().optional(),
    diffRamp: z.enum(["fixed", "flexible"]).optional(),
    speedCalc: z.enum(["normal", "extended"]).optional(),
    arrival: z.enum(["place", "timed", "off"]).optional(),
    departure: z.enum(["leadout", "off"]).optional(),
}).strict() satisfies z.ZodType<Partial<FormulaConfig>>;

const requestSchema = z.object({
    task: taskSchema,
    tracks: z.array(trackSchema).min(1),
    modality: z.enum(["PG", "HG"]).optional(),
    pilotsPresent: z.number().int().nonnegative().optional(),
    formulaOverrides: formulaOverridesSchema.optional(),
});

function getApiKey(request: Request): string | null {
    const header = request.headers.get("x-api-key");
    return typeof header === "string" && header.trim() ? header.trim() : null;
}

export async function POST(request: Request) {
    const configuredApiKey = process.env.GAP_SCORING_PUBLIC_API_KEY;

    if (!configuredApiKey) {
        return NextResponse.json(
            { error: "Server is missing GAP_SCORING_PUBLIC_API_KEY." },
            { status: 500 },
        );
    }

    const providedApiKey = getApiKey(request);
    if (providedApiKey !== configuredApiKey) {
        return NextResponse.json(
            { error: "Unauthorized." },
            { status: 401 },
        );
    }

    try {
        const json = await request.json();
        const parsed = requestSchema.safeParse(json);

        if (!parsed.success) {
            return NextResponse.json(
                {
                    error: "Invalid request payload.",
                    details: z.treeifyError(parsed.error),
                },
                { status: 400 },
            );
        }

        const scores = scoreJsonTracks(parsed.data).map((pilot) => ({
            [pilot.pilot_id]: {
                pilot_name: pilot.pilot_name,
                distance: pilot.distance,
                distance_points: pilot.distance_points,
                speed_points: pilot.speed_points,
                leading_points: pilot.leading_points,
                arrival_points: pilot.arrival_points,
                penalty: pilot.penalty,
                total: pilot.total,
                ess_time: pilot.ess_time,
                sss_time: pilot.sss_time,
                sss_crossing: pilot.sss_crossing,
                elapsed_time: pilot.elapsed_time,
                place: pilot.place,
                goal_made: pilot.goal_made,
                to_goal: pilot.to_goal,
                ts_seconds: pilot.ts_seconds,
                leading_coeff: pilot.leading_coeff,
            },
        }));

        return NextResponse.json(scores);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected scoring error.";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
