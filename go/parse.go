package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type XCTaskWaypoint struct {
	Waypoint struct {
		Name        string  `json:"name"`
		Description string  `json:"description"`
		Lat         float64 `json:"lat"`
		Lon         float64 `json:"lon"`
		AltSmoothed float64 `json:"altSmoothed"`
	} `json:"waypoint"`
	Radius float64 `json:"radius"`
	Type   string  `json:"type"`
}

type XCTaskSSS struct {
	Type      string   `json:"type"`
	Direction string   `json:"direction"`
	TimeGates []string `json:"timeGates"`
}

type XCTaskGoal struct {
	Type string `json:"type"`
}

type XCTask struct {
	Turnpoints []XCTaskWaypoint `json:"turnpoints"`	
	Sss        *XCTaskSSS       `json:"sss"`
	Goal       *XCTaskGoal      `json:"goal"`
}

func ParseXctsk(xctskInput interface{}) (Task, error) {
	var xctask XCTask

	switch v := xctskInput.(type) {
	case string:
		if err := json.Unmarshal([]byte(v), &xctask); err != nil {
			return Task{}, err
		}
	case XCTask:
		xctask = v
	default:
		return Task{}, fmt.Errorf("unsupported input type for ParseXctsk")
	}

	waypoints := make([]Waypoint, len(xctask.Turnpoints))
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

		waypoints[i] = Waypoint{
			LatLng: LatLng{Lat: t.Waypoint.Lat, Lon: t.Waypoint.Lon},
			Radius: radius,
			Type:   wptType,
		}
	}

	startTime := int64(0)
	if xctask.Sss != nil && len(xctask.Sss.TimeGates) > 0 {
		timeStr := strings.ReplaceAll(xctask.Sss.TimeGates[0], "Z", "")
		parts := strings.Split(timeStr, ":")
		if len(parts) == 3 {
			hour, _ := strconv.Atoi(parts[0])
			minute, _ := strconv.Atoi(parts[1])
			second, _ := strconv.Atoi(parts[2])
			
			// Create a time.Time object for today's date with UTC hours, minutes, seconds
			now := time.Now().UTC()
			t := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, second, 0, time.UTC)
			startTime = t.UnixMilli() // Convert to milliseconds since epoch
		}
	}

	goalType := "cylinder"
	if xctask.Goal != nil && xctask.Goal.Type == "LINE" {
		goalType = "line"
	}

	return Task{
		Waypoints: waypoints,
		StartTime: startTime,
		GoalType:  goalType,
	}, nil
}
