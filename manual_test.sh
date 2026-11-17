#!/bin/bash

BASE_URL="http://localhost:5000/api"

echo "Testing Health Endpoint..."
curl -X GET "$BASE_URL/health"
echo -e "\n"

echo "Testing Coupon Validation (Invalid)..."
curl -X POST "$BASE_URL/coupons/validate" \
  -H "Content-Type: application/json" \
  -d '{"code": "INVALID123"}'
echo -e "\n"

echo "Testing Payment Order Creation (Missing Keys expected if not configured)..."
curl -X POST "$BASE_URL/payment/orders" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50000, "currency": "INR", "receipt": "rcpt_1"}'
echo -e "\n"
