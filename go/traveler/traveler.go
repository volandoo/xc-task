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
	VisitedCount int                `json:"visitedCount"` // Number of waypoints successfully completed
	IsInsideNext bool               `json:"isInsideNext"` // Whether currently inside a waypoint
	TrackIndex   int                `json:"trackIndex"`   // Current position in GPS track
	Waypoints    []types.TrackPoint `json:"waypoints"`    // Track points where waypoints were entered
	// SSSTouches   []types.TrackPoint `json:"sssTouches"`   // All times the pilot touched the SSS waypoint
}

func GetSSSIndex(task types.Task) int {
	for i, wpt := range task.Waypoints {
		if wpt.Type == "sss" {
			return i
		}
	}
	return 1
}

func GetESSIndex(task types.Task) int {
	for i, wpt := range task.Waypoints {
		if wpt.Type == "ess" {
			return i
		}
	}
	return len(task.Waypoints) - 1
}

// TravelTask processes a GPS track against a flight task to determine completion progress
func TravelTask(
	task types.Task,
	track []types.TrackPoint,
	step *CurrentStep,
	onProgress func(step CurrentStep),
	onProgressInterval int,
) *CurrentStep {

	// Initialize step state if not provided
	if step == nil {
		step = &CurrentStep{
			Waypoints: make([]types.TrackPoint, len(task.Waypoints)),
			// SSSTouches: []types.TrackPoint{},
		}
	}

	// Require minimum 3 waypoints for valid task
	if len(task.Waypoints) < 3 {
		return step
	}

	// Find the SSS waypoint index
	sssIndex := GetSSSIndex(task)
	wasInsideSSS := false
	sssType := ""

	if step.VisitedCount < sssIndex+1 {

		// Determine SSS waypoint type by checking if next waypoint radius is outside SSS radius
		// If next waypoint radius is outside SSS radius, then SSS is "exit" type
		// If next waypoint radius is inside SSS radius, then SSS is "enter" type
		sssWaypoint := task.Waypoints[sssIndex]

		if sssIndex+1 < len(task.Waypoints) {
			nextWaypoint := task.Waypoints[sssIndex+1]
			distanceToNext := distanceBetweenWaypoints(sssWaypoint, nextWaypoint)

			// If the next waypoint radius is outside the SSS radius, SSS is an "exit" waypoint
			// If the next waypoint radius is inside the SSS radius, SSS is an "enter" waypoint
			if distanceToNext+nextWaypoint.Radius > sssWaypoint.Radius {
				sssType = "exit"
			} else {
				sssType = "enter"
			}
		}

		// Track whether we were inside SSS on the previous point
		if step.TrackIndex > 0 && step.TrackIndex < len(track) {
			wasInsideSSS = isInside(track[step.TrackIndex], task.Waypoints[sssIndex])
		}
	}

	// STEP 1: Find starting point - first track point inside the first waypoint
	if step.VisitedCount == 0 {
		for i := range track {
			if isInside(track[i], task.Waypoints[0]) {
				step.VisitedCount = 1                                     // Mark first waypoint as visited
				step.IsInsideNext = isInside(track[i], task.Waypoints[1]) // Set state to outside waypoint since its the first waypoint
				step.TrackIndex = i                                       // Record position in track
				step.Waypoints[0] = track[i].Copy()                       // Store entry point

				// Check if this starting point is also inside SSS
				if isInside(track[i], task.Waypoints[sssIndex]) {
					wasInsideSSS = true
				}
				break
			}
		}
	}

	// Exit if no valid starting point found
	if step.VisitedCount == 0 {
		return step
	}

	// STEP 2: Process remaining track points to complete waypoint sequence
	for i := step.TrackIndex + 1; i < len(track); i++ {
		point := track[i]
		step.TrackIndex = i
		// Only check for SSS waypoint touches if we haven't passed it yet
		// Stop tracking SSS once we've visited the waypoint after SSS
		if step.VisitedCount <= sssIndex+1 && sssType != "" {
			isCurrentlyInsideSSS := isInside(point, task.Waypoints[sssIndex])

			switch sssType {
			case "enter":
				// For "enter" type: track when pilot enters (outside -> inside)
				if isCurrentlyInsideSSS && !wasInsideSSS {
					// step.SSSTouches = append(step.SSSTouches, point.Copy())
					step.Waypoints[sssIndex] = point.Copy() // Store the last exit point
				}
			case "exit":
				// For "exit" type: track when pilot exits (inside -> outside)
				if !isCurrentlyInsideSSS && wasInsideSSS {
					// step.SSSTouches = append(step.SSSTouches, point.Copy())
					step.Waypoints[sssIndex] = point.Copy() // Store the last exit point
				}
			}

			wasInsideSSS = isCurrentlyInsideSSS
		}

		// Stop if all waypoints have been completed
		if step.VisitedCount >= len(task.Waypoints) {
			continue // Continue to track SSS touches even after task completion
		}

		if step.IsInsideNext {
			// STEP 2A: Currently inside the next waypoint - look for exit to mark as completed
			if isOutside(point, task.Waypoints[step.VisitedCount]) {
				step.Waypoints[step.VisitedCount] = point.Copy() // Store exit point
				step.VisitedCount++                              // Mark waypoint as completed
				if step.VisitedCount >= len(task.Waypoints) {
					break
				}
				step.IsInsideNext = isInside(point, task.Waypoints[step.VisitedCount])
			}
		} else {
			// STEP 2B: Currently outside the next waypoint - look for entry into next waypoint
			if isInside(point, task.Waypoints[step.VisitedCount]) {
				step.Waypoints[step.VisitedCount] = point.Copy() // Store entry point
				step.VisitedCount++                              // Mark waypoint as completed
				if step.VisitedCount >= len(task.Waypoints) {
					break
				}
				step.IsInsideNext = isInside(point, task.Waypoints[step.VisitedCount])
			}
		}

		if onProgressInterval > 0 && onProgress != nil && (i%onProgressInterval) == 0 {
			onProgress(*step)
		}
	}

	// remove any 0,0 waypoints
	step.Waypoints = removeZeroWaypoints(step.Waypoints)

	// Return updated step state with completion progress
	return step
}

func removeZeroWaypoints(waypoints []types.TrackPoint) []types.TrackPoint {

	filteredWaypoints := []types.TrackPoint{}
	for _, waypoint := range waypoints {
		if waypoint.LatLng.Lat != 0 && waypoint.LatLng.Lon != 0 {
			filteredWaypoints = append(filteredWaypoints, waypoint)
		}
	}
	return filteredWaypoints
}

func GeoJson(step *CurrentStep) []geojson.Feature {
	features := []geojson.Feature{}
	for i, point := range step.Waypoints {
		p := geojson.NewPointFeature([]float64{point.LatLng.Lon, point.LatLng.Lat})
		p.Properties = map[string]interface{}{
			"type":  "point",
			"name":  "Point",
			"color": "red",
			"index": i,
			"time":  time.Unix(int64(point.Time), 0).Format(time.RFC3339),
		}
		features = append(features, *p)
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

// distanceBetweenWaypoints calculates the distance between two waypoints
func distanceBetweenWaypoints(wp1, wp2 types.Waypoint) float64 {
	from := haversine.Coordinate{
		Latitude:  wp1.LatLng.Lat,
		Longitude: wp1.LatLng.Lon,
	}
	to := haversine.Coordinate{
		Latitude:  wp2.LatLng.Lat,
		Longitude: wp2.LatLng.Lon,
	}
	return float64(from.DistanceTo(to, haversine.M)) // Returns distance in meters
}
