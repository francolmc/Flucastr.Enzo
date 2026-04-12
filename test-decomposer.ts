#!/usr/bin/env node
/**
 * Test script for Decomposer implementation
 * Tests COMPLEX, MODERATE, and SIMPLE task classification and execution
 */

import { Decomposer } from '@enzo/core';
import { OllamaProvider } from '@enzo/core';

// Initialize provider
const ollamaHost = process.env.OLLAMA_HOST || 'localhost';
const ollamaPort = parseInt(process.env.OLLAMA_PORT || '11434', 10);
const ollamaModel = process.env.ORCHESTRATOR_MODEL || 'qwen2.5:3b';
const provider = new OllamaProvider(`http://${ollamaHost}:${ollamaPort}`, ollamaModel);

const decomposer = new Decomposer(provider);

async function testDecomposer() {
  console.log('🚀 Starting Decomposer tests...\n');

  // Test 1: COMPLEX task decomposition
  console.log('='.repeat(80));
  console.log('TEST 1: COMPLEX Task Decomposition');
  console.log('Input: "busca en internet qué es el desierto de Atacama y luego crea el archivo /tmp/atacama.md con un resumen"');
  console.log('='.repeat(80));

  const complexMessage =
    'busca en internet qué es el desierto de Atacama y luego crea el archivo /tmp/atacama.md con un resumen';
  const availableTools = ['web_search', 'read_file', 'execute_command', 'remember'];

  try {
    const result = await decomposer.decompose(complexMessage, availableTools);
    console.log('\n✅ Decomposition successful');
    console.log(`📊 Decomposed into ${result.steps.length} step(s):`);
    result.steps.forEach(step => {
      console.log(`  ${step.id}. ${step.tool}: ${step.description}`);
      if (step.dependsOn !== null) {
        console.log(`     ↳ Depends on step ${step.dependsOn}`);
      }
    });
  } catch (error) {
    console.error('❌ ERROR:', error);
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: Single Simple Task (fallback test)');
  console.log('Input: "hola"');
  console.log('='.repeat(80));

  try {
    const simpleMessage = 'hola';
    const simpleResult = await decomposer.decompose(simpleMessage, availableTools);
    console.log('\n✅ Decomposition successful (fallback)');
    console.log(`📊 Total steps: ${simpleResult.steps.length}`);
    console.log(`  Step 1 (fallback): ${simpleResult.steps[0]?.tool} - ${simpleResult.steps[0]?.description}`);
  } catch (error) {
    console.error('❌ ERROR:', error);
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Moderate Task Decomposition');
  console.log('Input: "busca el clima de Copiapó"');
  console.log('='.repeat(80));

  try {
    const moderateMessage = 'busca el clima de Copiapó';
    const moderateResult = await decomposer.decompose(moderateMessage, availableTools);
    console.log('\n✅ Decomposition successful');
    console.log(`📊 Total steps: ${moderateResult.steps.length}`);
    moderateResult.steps.forEach(step => {
      console.log(`  ${step.id}. ${step.tool}: ${step.description}`);
    });
  } catch (error) {
    console.error('❌ ERROR:', error);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✨ All tests completed');
  console.log('='.repeat(80));

  process.exit(0);
}

testDecomposer().catch(error => {
  console.error('🔥 Fatal error:', error);
  process.exit(1);
});
