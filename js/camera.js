/**
 * Camera Module - Handles camera access and video streaming
 */
class CameraManager {
  constructor() {
    this.videoElement = document.getElementById("videoFeed");
    this.cameraOverlay = document.getElementById("cameraOverlay");
    this.cameraSelect = document.getElementById("cameraSelect");
    this.stream = null;
    this.isActive = false;
  }

  /**
   * Start camera with specified facing mode
   * @param {string} facingMode - 'environment' (back) or 'user' (front)
   */
  async start(facingMode = "environment") {
    try {
      // Stop any existing stream
      this.stop();

      // Request camera access
      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.srcObject = this.stream;

      // Wait for video to be ready
      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });

      this.isActive = true;
      this.cameraOverlay.classList.add("hidden");

      console.log("Camera started successfully");
      return true;
    } catch (error) {
      console.error("Camera access error:", error);
      this.handleCameraError(error);
      return false;
    }
  }

  /**
   * Stop camera stream
   */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.videoElement.srcObject = null;
    this.isActive = false;
    this.cameraOverlay.classList.remove("hidden");
  }

  /**
   * Get current video frame as ImageData
   * @param {HTMLCanvasElement} canvas - Canvas to draw frame to
   * @returns {ImageData|null}
   */
  getFrame(canvas) {
    if (!this.isActive || !this.videoElement.videoWidth) {
      return null;
    }

    const ctx = canvas.getContext("2d");
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;

    ctx.drawImage(this.videoElement, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /**
   * Handle camera errors with user-friendly messages
   */
  handleCameraError(error) {
    let message = "Unable to access camera.";

    if (error.name === "NotAllowedError") {
      message =
        "Camera permission denied. Please allow camera access and refresh.";
    } else if (error.name === "NotFoundError") {
      message = "No camera found on this device.";
    } else if (error.name === "NotReadableError") {
      message = "Camera is in use by another application.";
    } else if (error.name === "OverconstrainedError") {
      message =
        "Camera does not meet requirements. Trying with default settings...";
      // Try with basic constraints
      this.startWithBasicConstraints();
      return;
    }

    // Update overlay with error message
    const placeholder = this.cameraOverlay.querySelector(".camera-placeholder");
    placeholder.innerHTML = `
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <p>${message}</p>
            <span class="hint">Check browser permissions</span>
        `;
  }

  /**
   * Fallback to basic camera constraints
   */
  async startWithBasicConstraints() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true });
      this.videoElement.srcObject = this.stream;

      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });

      this.isActive = true;
      this.cameraOverlay.classList.add("hidden");
    } catch (error) {
      console.error("Basic camera access also failed:", error);
    }
  }

  /**
   * Switch camera (front/back)
   */
  async switchCamera() {
    const currentMode = this.cameraSelect.value;
    await this.start(currentMode);
  }

  /**
   * Check if camera is supported
   */
  static isSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
}

// Export for use in other modules
window.CameraManager = CameraManager;
