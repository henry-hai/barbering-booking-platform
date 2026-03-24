// Static file server for the barbering website

// Module Imports
const fs = require("fs");        // File System
const http = require("http");    // HTTP Module

/*
* Create the server object that listens for incoming network HTTP requests.
* Callback Function: 
* - inRequest contains the parsed HTTP data sent by the browser. 
* - inResponse provides methods to format and transmit the HTTP response back to the browser.
*/
const server = http.createServer((inRequest, inResponse) => {  

    // Determine the file to serve based on the request URL
    // If the URL is the root (/), default to index.html. Otherwise, use the requested URL.
    let fileName = inRequest.url === "/" ? "index.html" : inRequest.url;

    // Build the absolute path to the file on the hard drive
    // __dirname is a global variable giving the exact path to the current folder
    let localPath = __dirname + "/" + fileName;

    // File System reads the file at the absolute path
    // Callback Function: inError triggers if the file fails to load. inData holds the actual file content if successful.
    fs.readFile(localPath, (inError, inData) => {
        if (inError) {
            // If the file is missing, send error message back to the browser
            inResponse.end("FILE NOT FOUND");
        } else {
            // If the file is found, send the raw file data (HTML or image) back to the browser
            inResponse.end(inData);
        }
    });
});


// Start the server listening on the specified port
const port = 3000;
server.listen(port, () => {
    console.log(`Server started on: ${port}`);
    console.log(`Click here to open: http://localhost:${port}`);
});
