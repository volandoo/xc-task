package compscore

import (
	"math"
	"sort"
	"sync"
)

type TrackPoint struct {
	Time float64 // seconds since epoch or monotonic base
	DTG  float64 // distance to ESS, in km
}

type Pilot struct {
	ID        string
	Track     []TrackPoint // sorted by Time ascending
	StartGate float64      // seconds since epoch (the start gate time this pilot used)
	// Landed bool // optional flag if you want special handling
}

// ComputeLeadingPerGate computes leading points for each pilot grouped by StartGate.
// - groups: pilots slice
// - availableLeadingPoints: value computed from GAP (leadingWeight * 1000 * taskValidity)
// - squareDistances: true for paragliding, false for hang gliding
// - exponent: typically 2/3 (0.6666667). Make configurable to follow rule changes.
// - endTime: the time to integrate to (e.g. last ESS time or task stop time). Use same endTime for all pilots in this gate.
// Returns map[pilotID]leadingPoints
func ComputeLeadingPerGate(pilots []Pilot, availableLeadingPoints float64, squareDistances bool, exponent float64, endTime float64) map[string]float64 {
	// Group pilots by start gate (use exact gate time; if multiple gates are very near, grouping key can be normalized)
	groups := map[float64][]Pilot{}
	for _, p := range pilots {
		groups[p.StartGate] = append(groups[p.StartGate], p)
	}

	results := make(map[string]float64)

	for gateTime, group := range groups {
		// For each pilot, integrate area under (t - gateTime, DTG(t)) up to endTime.
		type lcRes struct {
			id string
			lc float64
		}

		lcCh := make(chan lcRes, len(group))
		var wg sync.WaitGroup
		wg.Add(len(group))

		for _, pilot := range group {
			// copy for goroutine
			p := pilot
			go func() {
				defer wg.Done()
				lc := integratePilotLC(p.Track, gateTime, endTime, squareDistances)
				lcCh <- lcRes{id: p.ID, lc: lc}
			}()
		}
		wg.Wait()
		close(lcCh)

		LCs := make([]lcRes, 0, len(group))
		for r := range lcCh {
			LCs = append(LCs, r)
		}

		// compute LCmin and LCflow (mean)
		if len(LCs) == 0 {
			continue
		}
		var sum float64
		LCmin := LCs[0].lc
		for _, r := range LCs {
			if r.lc < LCmin {
				LCmin = r.lc
			}
			sum += r.lc
		}
		LCflow := sum / float64(len(LCs))

		// Defensive: if LCflow == LCmin (all identical LC), give full points to all with LC==LCmin,
		// otherwise zero for others. This avoids divide-by-zero and follows intended behaviour.
		for _, r := range LCs {
			var pts float64
			if LCflow == LCmin {
				if r.lc == LCmin {
					pts = availableLeadingPoints
				} else {
					pts = 0
				}
			} else {
				frac := 1.0 - (r.lc-LCmin)/(LCflow-LCmin)
				if frac < 0 {
					frac = 0
				}
				pts = availableLeadingPoints * math.Pow(frac, exponent)
			}
			results[r.id] = pts
		}

		// optional: stable ordering if you want debug output
		_ = gateTime // keep for logging if required
	}

	return results
}

// integratePilotLC integrates a pilot track between gateTime and endTime.
// - If the track ends before endTime (landed), it will "complete" by holding the last DTG constant until endTime.
// - If track starts after gateTime, integration begins at the first track point (no extrapolation backwards).
// - Uses trapezoid rule.
func integratePilotLC(track []TrackPoint, gateTime float64, endTime float64, squareDistances bool) float64 {
	if len(track) == 0 {
		return 0
	}
	// ensure sorted by time
	sort.SliceStable(track, func(i, j int) bool { return track[i].Time < track[j].Time })

	var area float64

	// find first index >= gateTime; if first point is before gateTime, start from the first point but with t normalized
	// we will integrate only where times advance and are within (gateTime..endTime]
	// also, add an artificial final point at endTime with dtg = lastKnownDTG (hold last DTG).
	n := len(track)
	lastPoint := track[n-1]
	// if last point time < endTime, we append an ephemeral point at endTime with same DTG
	ephemeralAdded := false
	if lastPoint.Time < endTime {
		ephemeral := TrackPoint{Time: endTime, DTG: lastPoint.DTG}
		track = append(track, ephemeral)
		ephemeralAdded = true
	}

	// integrate over consecutive points but skip segments entirely before gateTime or with non-positive dt
	for i := 1; i < len(track); i++ {
		tPrev := track[i-1].Time
		tCurr := track[i].Time
		// clamp both to [gateTime, endTime]
		if tCurr <= gateTime {
			continue
		}
		if tPrev < gateTime {
			tPrev = gateTime
		}
		if tCurr > endTime {
			tCurr = endTime
		}
		dt := tCurr - tPrev
		if dt <= 0 {
			continue
		}
		// pick values corresponding to the clamped times:
		// - If we clamped, we should pick DTG at the clamped times. For the backward clamp, we don't know an exact dtg at gateTime.
		//   Conservative choice: use the later point's dtg (track[i].DTG) for tCurr and track[i-1].DTG for tPrev as approximations.
		d1 := track[i-1].DTG
		d2 := track[i].DTG
		var val float64
		if squareDistances {
			val = (d1*d1 + d2*d2) / 2.0
		} else {
			val = (d1 + d2) / 2.0
		}
		area += val * dt
	}

	// if we appended ephemeral point, remove it to avoid mutating original backing slice semantics outside caller
	if ephemeralAdded {
		track = track[:len(track)-1]
	}
	return area
}
