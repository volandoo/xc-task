package parser

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/twpayne/go-igc"
	"github.com/volandoo/go-xctask/types"
)

func ParseXctsk(xctskInput string) (types.Task, error) {
	var xctask XCTask
	if err := json.Unmarshal([]byte(xctskInput), &xctask); err != nil {
		return types.Task{}, err
	}

	waypoints := make([]types.Waypoint, len(xctask.Turnpoints))
	for i, t := range xctask.Turnpoints {
		goal := i == len(xctask.Turnpoints)-1
		ess := i == len(xctask.Turnpoints)-2

		wptType := "turn"
		if t.Type == "TAKEOFF" || i == 0 {
			wptType = "takeoff"
		} else if t.Type == "SSS" || i == 1 {
			wptType = "start"
		} else if t.Type == "ESS" || ess {
			wptType = "ess"
		} else if t.Type == "GOAL" || goal {
			wptType = "goal"
		}

		radius := t.Radius
		if radius == 0 {
			radius = 400 // Default radius from TS code
		}

		waypoints[i] = types.Waypoint{
			LatLng: types.LatLng{Lat: t.Waypoint.Lat, Lon: t.Waypoint.Lon},
			Radius: radius,
			Type:   wptType,
		}
	}

	startTimes := []int64{}
	if xctask.Sss != nil && len(xctask.Sss.TimeGates) > 0 {
		for _, gate := range xctask.Sss.TimeGates {
			timeStr := strings.ReplaceAll(gate, "Z", "")
			parts := strings.Split(timeStr, ":")
			if len(parts) == 3 {
				hour, _ := strconv.Atoi(parts[0])
				minute, _ := strconv.Atoi(parts[1])
				second, _ := strconv.Atoi(parts[2])

				// Create a time.Time object for today's date with UTC hours, minutes, seconds
				now := time.Now().UTC()
				t := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, second, 0, time.UTC)
				startTimes = append(startTimes, t.UnixMilli()) // Convert to milliseconds since epoch
			}
		}
	}

	goalType := "cylinder"
	if xctask.Goal != nil && xctask.Goal.Type == "LINE" {
		goalType = "line"
	}

	return types.Task{
		Waypoints:  waypoints,
		StartTimes: startTimes,
		GoalType:   goalType,
	}, nil
}

func ParseIgc(igcInput string) ([]types.TrackPoint, error) {
	res, err := igc.Parse(strings.NewReader(igcInput))
	if err != nil {
		return []types.TrackPoint{}, err
	}
	var track []types.TrackPoint
	for _, record := range res.BRecords {
		track = append(track, types.TrackPoint{LatLng: types.LatLng{Lat: record.Lat, Lon: record.Lon}, Time: record.Time.Unix()})
	}
	return track, nil
}
