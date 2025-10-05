package traveler

import (
	"time"

	"github.com/kwahome/go-haversine/pkg/haversine"
	geojson "github.com/paulmach/go.geojson"
	"github.com/volandoo/go-xctask/types"
)

// TOLERANCE adds 0.1% buffer to waypoint radius to account for GPS inaccuracy
const TOLERANCE = 0.001
const SSS_INDEX = 1

// TravelWaypoint represents a waypoint entry point with timestamp
type TravelWaypoint struct {
	LatLng types.LatLng `json:"latLng"`
	Time   int64        `json:"time"`
}

// CurrentStep holds the current state of the task completion process
type CurrentStep struct {
	Visited    int                  `json:"visited"`    // Number of waypoints successfully completed
	Inside     bool                 `json:"inside"`     // Whether currently inside a waypoint
	TrackIndex int                  `json:"trackIndex"` // Current position in GPS track
	Waypoints  [][]types.TrackPoint `json:"waypoints"`  // Track points where waypoints were entered
}

// TravelTask processes a GPS track against a flight task to determine completion progress
func TravelTask(task types.Task, track []types.TrackPoint, step *CurrentStep) *CurrentStep {

	// Initialize step state if not provided
	if step == nil {
		step = &CurrentStep{
			Waypoints: make([][]types.TrackPoint, len(task.Waypoints)),
		}
	}

	// Require minimum 3 waypoints for valid task
	if len(task.Waypoints) < 3 {
		return step
	}

	// STEP 1: Find starting point - first track point inside the first waypoint
	if step.Visited == 0 {
		for i := range track {
			if isInside(track[i], task.Waypoints[0]) {
				step.Visited = 1                                               // Mark first waypoint as visited
				step.Inside = isInside(track[i], task.Waypoints[1])            // Set state to outside waypoint since its the first waypoint
				step.TrackIndex = i                                            // Record position in track
				step.Waypoints[0] = append(step.Waypoints[0], track[i].Copy()) // Store entry point
				break
			}
		}
	}

	// Exit if no valid starting point found
	if step.Visited == 0 {
		return step
	}

	// STEP 2: Process remaining track points to complete waypoint sequence
	for i := step.TrackIndex + 1; i < len(track); i++ {
		point := track[i]
		nextWaypoint := task.Waypoints[step.Visited]

		// Stop if all waypoints have been completed
		if step.Visited >= len(task.Waypoints) {
			break
		}

		// STEP 2A: Currently inside a waypoint - look for exit to mark as completed
		if step.Inside {
			if isOutside(point, nextWaypoint) {
				step.Waypoints[step.Visited] = append(step.Waypoints[step.Visited], point.Copy()) // Store exit point
				step.Visited++                                                                    // Mark waypoint as completed
				step.TrackIndex = i                                                               // Update track position
				if step.Visited >= len(task.Waypoints) {
					break
				}
				step.Inside = isInside(point, task.Waypoints[step.Visited])
			}
		} else {
			// STEP 2B: Currently outside - look for entry into next waypoint
			if isInside(point, nextWaypoint) {
				step.Waypoints[step.Visited] = append(step.Waypoints[step.Visited], point.Copy()) // Store entry point
				step.Visited++                                                                    // Mark waypoint as completed
				step.TrackIndex = i                                                               // Update track position
				if step.Visited >= len(task.Waypoints) {
					break
				}
				step.Inside = isInside(point, task.Waypoints[step.Visited])
			}
		}
	}

	// Return updated step state with completion progress
	return step
}

func GeoJson(step *CurrentStep) []geojson.Feature {
	features := []geojson.Feature{}
	for i, waypoint := range step.Waypoints {
		for j, point := range waypoint {
			p := geojson.NewPointFeature([]float64{point.LatLng.Lon, point.LatLng.Lat})
			p.Properties = map[string]interface{}{
				"type":         "point",
				"name":         "Point",
				"stroke":       "#204d74",
				"index":        j*len(step.Waypoints) + i,
				"stroke-width": 1,
				"time":         time.Unix(point.Time, 0).Format(time.RFC3339),
			}
			features = append(features, *p)
		}
	}
	return features
}

// isInside checks if a track point is within a waypoint's radius (with tolerance)
func isInside(trackPoint types.TrackPoint, wayPoint types.Waypoint) bool {
	return distance(trackPoint, wayPoint) <= wayPoint.Radius*(1+TOLERANCE)
}

// isOutside checks if a track point is outside a waypoint's radius (with tolerance)
func isOutside(trackPoint types.TrackPoint, wayPoint types.Waypoint) bool {
	return distance(trackPoint, wayPoint) > wayPoint.Radius*(1+TOLERANCE)
}

// distance calculates the great-circle distance between two geographic points using Haversine formula
func distance(trackPoint types.TrackPoint, wayPoint types.Waypoint) float64 {
	from := haversine.Coordinate{
		Latitude:  trackPoint.LatLng.Lat,
		Longitude: trackPoint.LatLng.Lon,
	}
	to := haversine.Coordinate{
		Latitude:  wayPoint.LatLng.Lat,
		Longitude: wayPoint.LatLng.Lon,
	}
	return float64(from.DistanceTo(to, haversine.M)) // Returns distance in meters
}
