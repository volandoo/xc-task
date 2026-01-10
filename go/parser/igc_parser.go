package parser

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/volandoo/go-xctask/types"
)

func ParseIgc(lines []string) (types.PilotInfo, []types.TrackPoint, error) {
	var pilot types.PilotInfo
	var track []types.TrackPoint
	now := time.Now().UTC()

	for _, line := range lines {
		if strings.HasPrefix(line, "B") {
			lat, lon, hour, minute, second, err := parseBRecord(line)
			if err != nil {
				// Skip invalid B-records but continue processing
				continue
			}

			// Create a time.Time object for today's date with UTC hours, minutes, seconds
			t := time.Date(now.Year(), now.Month(), now.Day(), hour, minute, second, 0, time.UTC)

			track = append(track, types.TrackPoint{
				LatLng: types.LatLng{
					Lat: lat,
					Lon: lon,
				},
				Time: t.Unix(),
			})
		}
		if strings.HasPrefix(line, "HFPLT") {
			name := strings.ReplaceAll(line, "HFPLTPILOTINCHARGE:", "")
			pilot.Name = strings.TrimSpace(name)
		}
		if strings.HasPrefix(line, "HFGTY") {
			wing := strings.ReplaceAll(line, "HFGTYGLIDERTYPE:", "")
			pilot.Wing = strings.TrimSpace(wing)
		}
	}

	return pilot, track, nil
}

// parseBRecord parses an IGC B-record and extracts latitude, longitude, and time
func parseBRecord(line string) (lat, lon float64, hour, minute, second int, err error) {
	if len(line) < 24 {
		return 0, 0, 0, 0, 0, fmt.Errorf("B-record too short: %s", line)
	}

	// Extract time (6 digits after 'B')
	timeStr := line[1:7]
	hour, err = strconv.Atoi(timeStr[0:2])
	if err != nil {
		return 0, 0, 0, 0, 0, fmt.Errorf("invalid hour: %s", timeStr[0:2])
	}
	minute, err = strconv.Atoi(timeStr[2:4])
	if err != nil {
		return 0, 0, 0, 0, 0, fmt.Errorf("invalid minute: %s", timeStr[2:4])
	}
	second, err = strconv.Atoi(timeStr[4:6])
	if err != nil {
		return 0, 0, 0, 0, 0, fmt.Errorf("invalid second: %s", timeStr[4:6])
	}

	// Extract latitude (8 characters: DDMM.MMM + N/S)
	if len(line) < 15 {
		return 0, 0, 0, 0, 0, fmt.Errorf("B-record too short for latitude: %s", line)
	}
	latStr := line[7:15]
	lat, err = parseDMMToDecimal(latStr, true)
	if err != nil {
		return 0, 0, 0, 0, 0, fmt.Errorf("invalid latitude: %s", latStr)
	}

	// Extract longitude (9 characters: DDDMM.MMM + E/W)
	if len(line) < 24 {
		return 0, 0, 0, 0, 0, fmt.Errorf("B-record too short for longitude: %s", line)
	}
	lonStr := line[15:24]
	lon, err = parseDMMToDecimal(lonStr, false)
	if err != nil {
		return 0, 0, 0, 0, 0, fmt.Errorf("invalid longitude: %s", lonStr)
	}

	return lat, lon, hour, minute, second, nil
}

// parseDMMToDecimal converts DMM (Degrees Decimal Minutes) format to decimal degrees
// For latitude: DDMM.MMM + N/S (8 characters: 7 digits + direction)
// For longitude: DDDMM.MMM + E/W (9 characters: 8 digits + direction)
func parseDMMToDecimal(dmmStr string, isLatitude bool) (float64, error) {
	if isLatitude && len(dmmStr) != 8 {
		return 0, fmt.Errorf("latitude string must be 8 characters: %s", dmmStr)
	}
	if !isLatitude && len(dmmStr) != 9 {
		return 0, fmt.Errorf("longitude string must be 9 characters: %s", dmmStr)
	}

	// Extract the direction character (last character)
	direction := dmmStr[len(dmmStr)-1]

	// Extract the numeric part (all but last character)
	numericPart := dmmStr[:len(dmmStr)-1]

	// Parse the numeric part as integer first
	value, err := strconv.ParseInt(numericPart, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid numeric part: %s", numericPart)
	}

	// Extract degrees and minutes
	var degrees, minutes float64
	if isLatitude {
		// Latitude: DDMM.MMM (first 2 digits are degrees, next 4 are minutes with 3 decimal places)
		degrees = float64(value / 100000)
		minutes = float64(value%100000) / 1000.0
	} else {
		// Longitude: DDDMM.MMM (first 3 digits are degrees, next 4 are minutes with 3 decimal places)
		degrees = float64(value / 100000)
		minutes = float64(value%100000) / 1000.0
	}

	// Convert to decimal degrees
	decimalDegrees := degrees + (minutes / 60.0)

	// Apply direction sign
	if direction == 'S' || direction == 'W' {
		decimalDegrees = -decimalDegrees
	} else if direction != 'N' && direction != 'E' {
		return 0, fmt.Errorf("invalid direction character: %c", direction)
	}

	return decimalDegrees, nil
}
