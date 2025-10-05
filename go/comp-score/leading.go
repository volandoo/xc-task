package compscore

import (
	"math"
)

type TrackPoint struct {
	Time float64 // seconds since epoch or any monotonic base
	DTG  float64 // distance to goal (km)
}

// ComputeLeadingPoints calculates leading points for multiple pilots.
//
// tracks: slice of pilots, each pilot has a slice of TrackPoints sorted by Time
// availablePoints: total leading points available (e.g., 81)
// squareDistances: true for paragliding, false for hang gliding
func ComputeLeadingPoints(tracks [][]TrackPoint, availablePoints float64, squareDistances bool) []float64 {
	if len(tracks) == 0 {
		return []float64{}
	}

	// find earliest start time across all pilots
	globalStart := tracks[0][0].Time
	for _, tr := range tracks {
		if tr[0].Time < globalStart {
			globalStart = tr[0].Time
		}
	}

	// --- 1. integrate each pilot’s distance-to-goal curve ---
	LCs := make([]float64, len(tracks))

	for i, tr := range tracks {
		var area float64
		for j := 1; j < len(tr); j++ {
			t1 := tr[j-1].Time - globalStart
			t2 := tr[j].Time - globalStart
			dt := t2 - t1
			if dt <= 0 {
				continue
			}
			d1 := tr[j-1].DTG
			d2 := tr[j].DTG
			var val float64
			if squareDistances {
				val = (math.Pow(d1, 2) + math.Pow(d2, 2)) / 2.0
			} else {
				val = (d1 + d2) / 2.0
			}
			area += val * dt
		}
		LCs[i] = area
	}

	// --- 2. compute LCmin and LCflow (mean LC) ---
	LCmin := LCs[0]
	var sum float64
	for _, v := range LCs {
		if v < LCmin {
			LCmin = v
		}
		sum += v
	}
	LCflow := sum / float64(len(LCs))

	// --- 3. convert to leading points ---
	points := make([]float64, len(LCs))
	for i, LC := range LCs {
		frac := 1 - (LC-LCmin)/(LCflow-LCmin)
		if frac < 0 {
			frac = 0
		}
		factor := math.Pow(frac, 2.0/3.0)
		points[i] = availablePoints * factor
	}

	return points
}
