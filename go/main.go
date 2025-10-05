package main

import (
	"flag"
	"fmt"
	"os"

	geojson "github.com/paulmach/go.geojson"
	"github.com/volandoo/go-xctask/parser"
	"github.com/volandoo/go-xctask/solver"
	"github.com/volandoo/go-xctask/traveler"
)

func main() {
	// Define command line flags
	taskFile := flag.String("task", "", "Path to the task file (.xctsk)")
	trackFile := flag.String("track", "", "Path to the track file (.igc or .gpx)")

	// Parse command line arguments
	flag.Parse()

	// Validate required arguments
	if *taskFile == "" {
		fmt.Fprintf(os.Stderr, "Error: --task argument is required\n")
		flag.Usage()
		os.Exit(1)
	}

	if *trackFile == "" {
		fmt.Fprintf(os.Stderr, "Error: --track argument is required\n")
		flag.Usage()
		os.Exit(1)
	}
	trackStr, err := os.ReadFile(*trackFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	track, err := parser.ParseIgc(string(trackStr))
	if err != nil {
		fmt.Fprintf(os.Stderr, "1 Error: %v\n", err)
		os.Exit(1)
	}

	taskStr, err := os.ReadFile(*taskFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	task, err := parser.ParseXctsk(string(taskStr))
	if err != nil {
		fmt.Fprintf(os.Stderr, "2 Error: %v\n", err)
		os.Exit(1)
	}
	res := traveler.TravelTask(task, track, nil)

	soverResult, err := solver.SolveTask(task.Waypoints, task.GoalType, true)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	trackLine := [][]float64{}
	for _, waypoint := range track {
		// circle with diameter
		trackLine = append(trackLine, []float64{waypoint.LatLng.Lon, waypoint.LatLng.Lat})
	}

	trackFeature := geojson.NewLineStringFeature(trackLine)
	trackFeature.Properties = map[string]interface{}{
		"type":         "track",
		"name":         "Track",
		"stroke":       "#204d74",
		"stroke-width": 1,
	}
	taskGeoJson := soverResult.GeoJSON
	taskGeoJson.AddFeature(trackFeature)
	travelerGeoJson := traveler.GeoJson(res)
	for _, feature := range travelerGeoJson {
		taskGeoJson.AddFeature(&feature)
	}
	geoJsonBytes, err := taskGeoJson.MarshalJSON()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("GeoJSON: %v\n", string(geoJsonBytes))
}
