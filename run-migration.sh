#!/bin/bash

RAILWAY_URL="https://connectbot-ai-production-2e05.up.railway.app"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║          🗄️  DATABASE MIGRATION RUNNER                        ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if backend is running
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 1: Checking if backend is running..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$RAILWAY_URL/" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Backend is running"
else
    echo "❌ Backend is not responding (HTTP $HTTP_CODE)"
    echo "   Wait for Railway deployment to complete"
    exit 1
fi

echo ""

# Check migration status
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 2: Checking migration status..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

curl -s "$RAILWAY_URL/api/migrate/status" > /tmp/migration_status.json

if cat /tmp/migration_status.json | grep -q '"tablesExist":true'; then
    echo "✅ Database tables already exist"
    echo ""
    cat /tmp/migration_status.json
    echo ""
    echo ""
    echo "ℹ️  Migration already completed. You're ready to use the app!"
    exit 0
fi

echo "⚠️  Database tables don't exist yet"
echo ""

# Run migration
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Step 3: Running database migration..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

curl -s -X POST "$RAILWAY_URL/api/migrate/run" > /tmp/migration_result.json

echo ""
cat /tmp/migration_result.json
echo ""
echo ""

if cat /tmp/migration_result.json | grep -q '"success":true'; then
    echo "✅ Migration completed successfully!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🎉 READY TO TEST"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Your database is now ready!"
    echo ""
    echo "Next steps:"
    echo "  1. Go to: https://connectbot-ai-frontend.vercel.app"
    echo "  2. Click: 'Sign in with Google'"
    echo "  3. Authenticate with Google"
    echo "  4. Should work! ✅"
    echo ""
else
    echo "❌ Migration failed"
    echo ""
    echo "Check the error above and try again, or check Railway logs."
    exit 1
fi

# Cleanup
rm -f /tmp/migration_status.json /tmp/migration_result.json 2>/dev/null
