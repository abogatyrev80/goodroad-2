# Deployment Guide for Good Road App

## Environment Variables for Production

### Required Environment Variables

The following environment variables **MUST** be set in your production deployment:

#### MongoDB Atlas Connection

```bash
# MongoDB Atlas connection string (REQUIRED)
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority

# Database name (REQUIRED)
MONGODB_DB_NAME=good_road_production
```

**Important Notes:**
- The application prioritizes `MONGODB_URI` over `MONGO_URL` for production deployments
- For MongoDB Atlas, SSL/TLS is automatically enabled when `mongodb+srv://` or `mongodb.net` is detected
- The connection includes retry logic (5 attempts with exponential backoff)
- The app will start in degraded mode if MongoDB is temporarily unavailable

## Health Check Endpoints

The application provides two health check endpoints for Kubernetes probes:

### Liveness Probe: `/health`

- **Purpose:** Checks if the application process is running
- **Returns:** Always 200 OK if process is alive
- **Use for:** Kubernetes liveness probe

### Readiness Probe: `/ready`

- **Purpose:** Checks if the application is ready to serve traffic
- **Checks:** MongoDB connection status
- **Returns:** 200 OK if ready, 503 Service Unavailable if not ready
- **Use for:** Kubernetes readiness probe

## Deployment Checklist

- [ ] Set `MONGODB_URI` environment variable with Atlas connection string
- [ ] Set `MONGODB_DB_NAME` environment variable
- [ ] Verify MongoDB Atlas network access allows your deployment IPs
- [ ] Configure health check probes
- [ ] Test connection after deployment
