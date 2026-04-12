#!/bin/bash

echo "🔍 IMPLEMENTATION VALIDATION REPORT"
echo "=================================="
echo ""

# Check Decomposer.ts created
if [ -f "packages/core/src/orchestrator/Decomposer.ts" ]; then
  echo "✅ Decomposer.ts created"
  wc -l packages/core/src/orchestrator/Decomposer.ts | awk '{print "   Lines: " $1}'
else
  echo "❌ Decomposer.ts NOT found"
fi

echo ""

# Check types.ts updated
if grep -q "decomposition\?" packages/core/src/orchestrator/types.ts; then
  echo "✅ types.ts updated with decomposition field"
  grep "decomposition\?" packages/core/src/orchestrator/types.ts | head -1
else
  echo "❌ types.ts NOT updated"
fi

echo ""

# Check AmplifierLoop imports
if grep -q "import.*Decomposer" packages/core/src/orchestrator/AmplifierLoop.ts; then
  echo "✅ AmplifierLoop has Decomposer import"
else
  echo "❌ AmplifierLoop missing Decomposer import"
fi

echo ""

# Check AmplifierLoop property
if grep -q "private decomposer: Decomposer" packages/core/src/orchestrator/AmplifierLoop.ts; then
  echo "✅ AmplifierLoop has decomposer property"
else
  echo "❌ AmplifierLoop missing decomposer property"
fi

echo ""

# Check AmplifierLoop initialization
if grep -q "this.decomposer = new Decomposer" packages/core/src/orchestrator/AmplifierLoop.ts; then
  echo "✅ AmplifierLoop initializes decomposer in constructor"
else
  echo "❌ AmplifierLoop NOT initializing decomposer"
fi

echo ""

# Check COMPLEX decomposition logic
if grep -q "COMPLEX task — decomposing into subtasks" packages/core/src/orchestrator/AmplifierLoop.ts; then
  echo "✅ COMPLEX decomposition logic present in AmplifierLoop"
  grep -n "COMPLEX task — decomposing" packages/core/src/orchestrator/AmplifierLoop.ts | awk '{print "   Line: " $1}'
else
  echo "❌ COMPLEX decomposition logic NOT found"
fi

echo ""

# Check subtask execution loop
if grep -q "for (const subtask of subtasks)" packages/core/src/orchestrator/AmplifierLoop.ts; then
  echo "✅ Subtask execution loop present"
else
  echo "❌ Subtask execution loop NOT found"
fi

echo ""

# Check exports in index.ts
if grep -q "export.*Decomposer" packages/core/src/orchestrator/index.ts; then
  echo "✅ index.ts exports Decomposer"
else
  echo "❌ index.ts NOT exporting Decomposer"
fi

echo ""

# Check TypeScript compilation
if [ -f "packages/core/dist/orchestrator/Decomposer.js" ]; then
  echo "✅ Decomposer.ts compiled successfully"
  wc -l packages/core/dist/orchestrator/Decomposer.js | awk '{print "   Compiled lines: " $1}'
else
  echo "❌ Decomposer.js NOT compiled"
fi

echo ""
echo "=================================="
echo "Validation complete!"
