# Good Road - Deployment Guide

## Deployment Configuration

This guide explains how to deploy the Good Road application to production with MongoDB Atlas.

## Required Environment Variables for Production

### Backend (Production Deployment)

The deployment platform must inject the following environment variables:

```bash
# MongoDB Atlas Connection (REQUIRED)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=good_road_production
```

**Important Notes:**
- Replace `username` and `password` with your MongoDB Atlas credentials
- Replace `cluster.mongodb.net` with your actual cluster address
- The application automatically detects `mongodb+srv://` and enables SSL/TLS
- Connection includes automatic retry logic (5 attempts with 5 second delays)
- Health checks are available at `/health` and `/ready` endpoints

### MongoDB Atlas Setup Checklist

1. **Create MongoDB Atlas Cluster**
   - Sign up at https://www.mongodb.com/cloud/atlas
   - Create a new cluster (M0 Free tier is sufficient for testing)
   - Wait for cluster to be created (~5 minutes)

2. **Configure Network Access**
   - Go to Network Access in Atlas dashboard
   - Add IP Address: `0.0.0.0/0` (Allow from anywhere) for initial testing
   - For production, restrict to your deployment platform's IP ranges

3. **Create Database User**
   - Go to Database Access in Atlas dashboard
   - Add New Database User
   - Choose Password authentication
   - Set username and strong password
   - Grant "Read and write to any database" role

4. **Get Connection String**
   - Go to Clusters → Connect
   - Choose "Connect your application"
   - Select Driver: Python, Version: 3.11 or later
   - Copy the connection string
   - Replace `<password>` with your actual password
   - Format: `mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority`

### Frontend (Mobile App)

The mobile app uses the backend URL from deployment. Ensure `app.json` contains:

```json
{
  "extra": {
    "backendUrl": "https://your-production-domain.com"
  }
}
```

## Health Check Endpoints

The application provides two health check endpoints for Kubernetes:

### Liveness Probe
```
GET /health
```
Returns 200 if the service is running. Use for Kubernetes liveness probe.

### Readiness Probe
```
GET /ready
```
Returns 200 only if MongoDB is connected and responsive. Use for Kubernetes readiness probe.

Example response when ready:
```json
{
  "status": "ready",
  "mongodb": "connected",
  "database": "good_road_production"
}
```

## Architecture Features for Production

### Connection Management
- **Automatic Retry**: 5 connection attempts with 5-second delays
- **Connection Pooling**: Motor manages connection pool automatically
- **Timeout Settings**:
  - Server Selection: 5 seconds
  - Connect: 10 seconds
  - Socket: 10 seconds
- **SSL/TLS**: Automatically enabled for MongoDB Atlas
- **Graceful Shutdown**: Proper cleanup on application shutdown

### Logging
- Structured logging with timestamps
- Connection status logging
- Error tracking with details
- Health check monitoring

### Database Collections

The application uses the following MongoDB collections:
- `sensor_data` - Legacy sensor data from old architecture
- `raw_sensor_data` - New architecture: raw sensor readings
- `processed_events` - New architecture: ML-classified events
- `user_warnings` - Active warnings for users
- `road_conditions` - Analyzed road conditions
- `road_warnings` - Warning records
- `calibration_profiles` - Device calibration data

## Deployment Checklist

- [ ] MongoDB Atlas cluster created and running
- [ ] Database user created with proper permissions
- [ ] Network access configured (0.0.0.0/0 for testing)
- [ ] Connection string obtained from Atlas
- [ ] `MONGODB_URI` environment variable set in deployment
- [ ] `MONGODB_DB_NAME` environment variable set in deployment
- [ ] Backend deployed and `/health` returns 200
- [ ] Backend `/ready` returns 200 with MongoDB connected
- [ ] Frontend `app.json` updated with production backend URL
- [ ] Mobile app can connect to backend

## Troubleshooting

### Deployment Fails with "MongoDB connection failed"

**Causes:**
1. Invalid connection string format
2. Network access not configured in Atlas
3. Database user credentials incorrect
4. Cluster not ready or paused

**Solutions:**
1. Verify `MONGODB_URI` format: `mongodb+srv://user:pass@cluster.mongodb.net/...`
2. Check Network Access allows `0.0.0.0/0` in Atlas
3. Verify username and password in connection string
4. Ensure Atlas cluster is running (not paused)

### `/ready` endpoint returns 503

**Cause:** MongoDB not connected or not responsive

**Solution:**
1. Check backend logs for connection errors
2. Verify `MONGODB_URI` is correctly set
3. Test connection string using MongoDB Compass or `mongosh`
4. Check Atlas cluster status

### Application starts but no data appears

**Cause:** Wrong database name

**Solution:**
1. Verify `MONGODB_DB_NAME` matches your intended database
2. Check Atlas cluster using MongoDB Compass
3. Review backend logs for database operations

## Monitoring

Monitor these endpoints in production:

1. **Health Status**: `GET /health` - Should always return 200
2. **Readiness Status**: `GET /ready` - Should return 200 when operational
3. **API Status**: `GET /api/` - Returns service info with MongoDB status

## Rollback Plan

If deployment fails:

1. **Quick Rollback**: Deployment platform should support instant rollback to previous version
2. **Data Safety**: All data is in MongoDB Atlas and preserved across deployments
3. **Verify**: Check `/health` and `/ready` endpoints after rollback

## Post-Deployment Verification

After successful deployment, verify:

```bash
# 1. Health check
curl https://your-domain.com/health
# Expected: {"status":"healthy",...}

# 2. Readiness check
curl https://your-domain.com/ready
# Expected: {"status":"ready","mongodb":"connected",...}

# 3. API root
curl https://your-domain.com/api/
# Expected: {"message":"Good Road API...","mongodb_connected":true}

# 4. Test data submission (from mobile app)
# Verify data appears in MongoDB Atlas

# 5. Admin dashboard (if configured)
curl https://your-domain.com/api/admin/analytics
# Expected: JSON with statistics
```

## Security Best Practices

1. **Never commit credentials**: Keep `MONGODB_URI` in deployment environment only
2. **Use strong passwords**: MongoDB Atlas user should have complex password
3. **Restrict network access**: After testing, limit Atlas network access to specific IPs
4. **Enable monitoring**: Set up Atlas monitoring and alerts
5. **Regular backups**: Configure automated backups in Atlas
6. **Connection string**: Never log or expose full connection string with password

## Support

For deployment issues:
1. Check backend logs for detailed error messages
2. Verify MongoDB Atlas cluster status
3. Test connection string with MongoDB Compass
4. Review this deployment guide

---

**Version:** 2.0.0  
**Last Updated:** 2025  
**Architecture:** Server-side ML Processing with Raw Data Collection
