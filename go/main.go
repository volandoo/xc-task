package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
)

func main() {
	var filePath string
	flag.StringVar(&filePath, "file", "", "Path to the XCTSK JSON file")
	flag.Parse()

	if filePath == "" {
		log.Fatal("Please provide a file path using the --file flag.")
	}

	// Read the content of the specified file
	fileContent, err := os.ReadFile(filePath)
	if err != nil {
		log.Fatalf("Error reading file %s: %v", filePath, err)
	}

	// Parse the input JSON string into an XCTask struct
	task, err := ParseXctsk(string(fileContent))
	if err != nil {
		log.Fatalf("Error parsing XCTask: %v", err)
	}

	// Process the task
	result, err := processTask(task.Waypoints, task.GoalType, true)
	if err != nil {
		log.Fatalf("Error processing task: %v", err)
	}

	// Marshal the result into a JSON string
	outputJSON, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		log.Fatalf("Error marshalling result to JSON: %v", err)
	}

	// Print the JSON string to stdout
	fmt.Println(string(outputJSON))
}
