# Let's Sign

Live demo that recognises ASL letters and words from a webcam and translates them to Arabic and Spanish. It runs fully in the browser: the camera video never leaves the device.

- **Letters:** hold a sign still for 1.5 seconds to add it.
- **Words:** hi, good, how are you, thank you, computer vision.
- **Tutor:** copy the outline on the camera to practise A–Z.

## How it works
MediaPipe Hands finds 21 hand landmarks. A small neural network (a fine-tuned MLP, exported from Keras to JSON) classifies the landmarks, and the page runs it in plain JavaScript. Translation uses a built-in dictionary for the known words and the MyMemory API for anything else.

Fine-tuned model and Arabic/Spanish translation feature by Roaa. Team course project for AI385, Computer Vision.

## Run locally
Serve the folder over http, for example `python -m http.server 8000`, then open http://localhost:8000. The camera needs https or localhost.
