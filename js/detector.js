/**
 * Fire & Smoke Detector Module
 * Uses simple color analysis for fire detection
 */
class FireDetector {
    constructor() {
        this.canvas = document.getElementById('detectionCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.isRunning = false;
        this.sensitivity = 2; // 1=Low, 2=Medium, 3=High
        this.lastDetection = null;
        this.frameHistory = [];
        this.maxHistoryFrames = 5;
        
        // Simple thresholds
        this.thresholds = {
            1: { fire: 0.35, smoke: 0.60, minPixels: 0.008 },
            2: { fire: 0.25, smoke: 0.50, minPixels: 0.005 },
            3: { fire: 0.15, smoke: 0.40, minPixels: 0.003 }
        };
        
        // Require consecutive frames before alert
        this.consecutiveFramesRequired = 3;
        this.consecutiveFireFrames = 0;
        this.consecutiveSmokeFrames = 0;

        // Smoke: gray colors
        this.smokeColors = {
            satMax: 15,
            lightMin: 40,
            lightMax: 75
        };

        // Callbacks
        this.onDetection = null;
        this.onConfidenceUpdate = null;
    }

    setSensitivity(level) {
        this.sensitivity = Math.max(1, Math.min(3, level));
    }

    start(camera) {
        this.isRunning = true;
        this.camera = camera;
        this.frameHistory = [];
        this.consecutiveFireFrames = 0;
        this.consecutiveSmokeFrames = 0;
        this.detect();
    }

    stop() {
        this.isRunning = false;
        this.frameHistory = [];
        this.clearOverlay();
    }

    detect() {
        if (!this.isRunning) return;

        const imageData = this.camera.getFrame(this.canvas);
        
        if (imageData) {
            const result = this.analyzeFrame(imageData);
            
            if (this.onConfidenceUpdate) {
                this.onConfidenceUpdate(result);
            }

            const threshold = this.thresholds[this.sensitivity];
            
            // Fire detection
            if (result.fireConfidence >= threshold.fire && result.firePixelRatio >= threshold.minPixels) {
                this.consecutiveFireFrames++;
                if (this.consecutiveFireFrames >= this.consecutiveFramesRequired) {
                    this.handleDetection(result, 'fire');
                }
            } else {
                this.consecutiveFireFrames = Math.max(0, this.consecutiveFireFrames - 1);
            }
            
            // Smoke detection
            if (result.smokeConfidence >= threshold.smoke && 
                result.smokePixelRatio >= threshold.minPixels &&
                this.detectMotion()) {
                this.consecutiveSmokeFrames++;
                if (this.consecutiveSmokeFrames >= this.consecutiveFramesRequired + 2) {
                    this.handleDetection(result, 'smoke');
                }
            } else {
                this.consecutiveSmokeFrames = Math.max(0, this.consecutiveSmokeFrames - 1);
            }

            this.drawOverlay(result);
        }

        requestAnimationFrame(() => {
            setTimeout(() => this.detect(), 66);
        });
    }

    analyzeFrame(imageData) {
        const data = imageData.data;
        const totalPixels = imageData.width * imageData.height;
        
        let firePixels = 0;
        let smokePixels = 0;
        const fireRegions = [];
        const smokeRegions = [];

        // Sample every 4th pixel
        for (let i = 0; i < data.length; i += 16) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            
            // SIMPLE FIRE CHECK: Bright red with low blue
            if (this.isFireColor(r, g, b)) {
                firePixels++;
                const pixelIndex = i / 4;
                const x = (pixelIndex % imageData.width) * 4;
                const y = Math.floor(pixelIndex / imageData.width) * 4;
                fireRegions.push({ x, y, intensity: r });
            }
            
            // Smoke check
            const { h, s, l } = this.rgbToHsl(r, g, b);
            if (this.isSmokeColor(s, l)) {
                smokePixels++;
                const pixelIndex = i / 4;
                const x = (pixelIndex % imageData.width) * 4;
                const y = Math.floor(pixelIndex / imageData.width) * 4;
                smokeRegions.push({ x, y, intensity: l });
            }
        }

        const sampledPixels = totalPixels / 4;
        const fireRatio = firePixels / sampledPixels;
        const smokeRatio = smokePixels / sampledPixels;
        
        // Simple confidence calculation
        let fireConfidence = Math.min(1, fireRatio * 10);
        let smokeConfidence = Math.min(1, smokeRatio * 6);
        
        // Store for flickering analysis
        this.frameHistory.push({ fireRatio, smokeRatio, timestamp: Date.now() });
        if (this.frameHistory.length > this.maxHistoryFrames) {
            this.frameHistory.shift();
        }

        return {
            fireConfidence,
            smokeConfidence,
            fireRegions: this.clusterRegions(fireRegions),
            smokeRegions: this.clusterRegions(smokeRegions),
            firePixelRatio: fireRatio,
            smokePixelRatio: smokeRatio
        };
    }

    /**
     * SIMPLE fire color check
     * Fire = Very bright red, much higher than green, blue is low
     */
    isFireColor(r, g, b) {
        // Fire characteristics:
        // 1. Red is BRIGHT (> 200)
        // 2. Red is much higher than green (R - G > 50)
        // 3. Blue is low (< 100)
        // 4. NOT skin tone (skin has higher blue and smaller R-G gap)
        
        const isBrightRed = r > 200;
        const redDominant = (r - g) > 50;
        const lowBlue = b < 100;
        
        // Skin tone exclusion: skin has B > 80 typically and smaller R-G gap
        const notSkin = !((r - g) < 60 && b > 70 && g > 100);
        
        return isBrightRed && redDominant && lowBlue && notSkin;
    }

    /**
     * Smoke = Low saturation gray
     */
    isSmokeColor(s, l) {
        return s <= this.smokeColors.satMax && 
               l >= this.smokeColors.lightMin && 
               l <= this.smokeColors.lightMax;
    }

    /**
     * Check if pixel color matches smoke characteristics
     * Much stricter to avoid false positives from walls/furniture
     */
    isSmokeColor(h, s, l) {
        // Smoke must be very low saturation (almost gray)
        const hasVeryLowSaturation = s <= this.smokeColors.satMax;
        // Must be in correct lightness range (not pure white or dark)
        const hasSmokeLightness = l >= this.smokeColors.lightMin && l <= this.smokeColors.lightMax;
        // Smoke often has slight blue-gray tint OR is pure gray (s < 5)
        const hasSmokeHue = s < 5 || (h >= this.smokeColors.hueMin && h <= this.smokeColors.hueMax);
        
        return hasVeryLowSaturation && hasSmokeLightness && hasSmokeHue;
    }
    
    /**
     * Detect motion between frames to distinguish smoke from static gray objects
     */
    detectMotion() {
        if (this.frameHistory.length < 3) return false;
        
        let motionScore = 0;
        for (let i = 1; i < this.frameHistory.length; i++) {
            const diff = Math.abs(this.frameHistory[i].smokeRatio - this.frameHistory[i - 1].smokeRatio);
            if (diff > 0.005) motionScore++;
        }
        
        // Require movement in smoke regions (billowing effect)
        return motionScore >= 2;
    }

    /**
     * Convert RGB to HSL
     */
    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
                case g: h = ((b - r) / d + 2) / 6; break;
                case b: h = ((r - g) / d + 4) / 6; break;
            }
        }

        return { h: h * 360, s: s * 100, l: l * 100 };
    }

    /**
     * Calculate flicker bonus based on frame history
     */
    calculateFlickerBonus() {
        if (this.frameHistory.length < 3) return 0;
        
        let variations = 0;
        for (let i = 1; i < this.frameHistory.length; i++) {
            const diff = Math.abs(this.frameHistory[i].fireRatio - this.frameHistory[i - 1].fireRatio);
            if (diff > 0.01) variations++;
        }
        
        return variations / (this.frameHistory.length - 1);
    }

    /**
     * Cluster nearby regions for visualization
     */
    clusterRegions(regions) {
        if (regions.length === 0) return [];
        
        // Simple clustering - just return bounding boxes of detected areas
        const clusters = [];
        const gridSize = 50;
        const grid = {};
        
        regions.forEach(({ x, y }) => {
            const key = `${Math.floor(x / gridSize)}_${Math.floor(y / gridSize)}`;
            if (!grid[key]) {
                grid[key] = { count: 0, x: x, y: y };
            }
            grid[key].count++;
        });
        
        Object.values(grid).forEach(cell => {
            if (cell.count > 2) {
                clusters.push({
                    x: cell.x,
                    y: cell.y,
                    size: Math.min(80, cell.count * 5)
                });
            }
        });
        
        return clusters.slice(0, 10); // Limit to 10 clusters
    }

    /**
     * Handle detection event
     */
    handleDetection(result, type) {
        const now = Date.now();
        const confidence = type === 'fire' ? result.fireConfidence : result.smokeConfidence;
        
        // Debounce detections (min 5 seconds apart for same type)
        if (this.lastDetection && 
            this.lastDetection.type === type && 
            now - this.lastDetection.timestamp < 5000) {
            return;
        }
        
        this.lastDetection = {
            type,
            confidence,
            timestamp: now
        };
        
        // Reset consecutive counters after detection
        if (type === 'fire') {
            this.consecutiveFireFrames = 0;
        } else {
            this.consecutiveSmokeFrames = 0;
        }
        
        if (this.onDetection) {
            this.onDetection({
                type,
                confidence: Math.round(confidence * 100),
                timestamp: now
            });
        }
    }

    /**
     * Draw detection overlay on canvas
     */
    drawOverlay(result) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw fire regions
        result.fireRegions.forEach(region => {
            this.ctx.beginPath();
            this.ctx.arc(region.x, region.y, region.size, 0, Math.PI * 2);
            this.ctx.strokeStyle = 'rgba(255, 77, 0, 0.8)';
            this.ctx.lineWidth = 3;
            this.ctx.stroke();
            this.ctx.fillStyle = 'rgba(255, 77, 0, 0.2)';
            this.ctx.fill();
        });
        
        // Draw smoke regions
        result.smokeRegions.forEach(region => {
            this.ctx.beginPath();
            this.ctx.arc(region.x, region.y, region.size, 0, Math.PI * 2);
            this.ctx.strokeStyle = 'rgba(139, 157, 195, 0.8)';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            this.ctx.fillStyle = 'rgba(139, 157, 195, 0.2)';
            this.ctx.fill();
        });
    }

    /**
     * Clear the detection overlay
     */
    clearOverlay() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
}

// Export for use in other modules
window.FireDetector = FireDetector;
