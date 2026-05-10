FROM python:3.11-slim

WORKDIR /app

# Install system dependencies + Chromium system libs
# Note: playwright --with-deps fails on Debian Trixie due to renamed font packages;
# we install the required libs manually and let Playwright handle the browser binary.
RUN apt-get update && apt-get install -y \
    gcc \
    postgresql-client \
    # Chromium / Playwright required system libs
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2t64 \
    libpango-1.0-0 \
    libcairo2 \
    libx11-6 \
    libxext6 \
    libxcb1 \
    fonts-liberation \
    fonts-unifont \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright chromium browser binary only (deps already installed above)
RUN playwright install chromium

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
