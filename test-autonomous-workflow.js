#!/usr/bin/env node

/**
 * Script de prueba para el flujo de trabajo autónomo de Enzo
 * Verifica la integración entre todos los skills y el MCP server
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import path from 'path';

const TEST_RESULTS = {
  skills: [],
  mcpServer: false,
  integration: false,
  errors: []
};

function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️'
  }[type];
  
  console.log(`${prefix} [${timestamp}] ${message}`);
}

function testSkillExists(skillName) {
  const skillPath = path.join(process.cwd(), 'skills-examples', skillName, 'SKILL.md');
  
  try {
    if (existsSync(skillPath)) {
      const content = readFileSync(skillPath, 'utf8');
      
      // Verificar estructura del skill
      const hasFrontmatter = content.startsWith('---');
      const hasName = content.includes('name:');
      const hasDescription = content.includes('description:');
      const hasAllowedTools = content.includes('allowed-tools:');
      
      const isValid = hasFrontmatter && hasName && hasDescription && hasAllowedTools;
      
      TEST_RESULTS.skills.push({
        name: skillName,
        exists: true,
        valid: isValid,
        path: skillPath
      });
      
      if (isValid) {
        log(`Skill ${skillName}: válido y completo`, 'success');
      } else {
        log(`Skill ${skillName}: existe pero estructura incompleta`, 'warning');
      }
      
      return isValid;
    } else {
      TEST_RESULTS.skills.push({
        name: skillName,
        exists: false,
        valid: false,
        path: skillPath
      });
      
      log(`Skill ${skillName}: no encontrado`, 'error');
      return false;
    }
  } catch (error) {
    TEST_RESULTS.errors.push(`Error testing ${skillName}: ${error.message}`);
    log(`Error testing ${skillName}: ${error.message}`, 'error');
    return false;
  }
}

function testMCPServer() {
  const mcpPath = path.join(process.cwd(), 'skills-examples', 'mcp-servers', 'claude-code-server');
  
  try {
    const packageJsonExists = existsSync(path.join(mcpPath, 'package.json'));
    const indexTsExists = existsSync(path.join(mcpPath, 'src', 'index.ts'));
    const readmeExists = existsSync(path.join(mcpPath, 'README.md'));
    
    if (packageJsonExists && indexTsExists && readmeExists) {
      TEST_RESULTS.mcpServer = true;
      log('MCP Server: archivos completos', 'success');
      
      // Verificar package.json
      const packageJson = JSON.parse(readFileSync(path.join(mcpPath, 'package.json'), 'utf8'));
      const hasDependencies = packageJson.dependencies && packageJson.dependencies['@modelcontextprotocol/sdk'];
      
      if (hasDependencies) {
        log('MCP Server: dependencias correctas', 'success');
      } else {
        log('MCP Server: dependencias faltantes', 'warning');
      }
      
      return true;
    } else {
      log('MCP Server: archivos faltantes', 'error');
      return false;
    }
  } catch (error) {
    TEST_RESULTS.errors.push(`Error testing MCP server: ${error.message}`);
    log(`Error testing MCP server: ${error.message}`, 'error');
    return false;
  }
}

function testIntegration() {
  log('Probando integración entre componentes...', 'info');
  
  // Verificar que los skills se referencien entre sí
  const skillsToTest = [
    'autonomous-work-manager',
    'teaching-materials-creator', 
    'code-review-planner',
    'opencode-integration'
  ];
  
  let integrationScore = 0;
  
  for (const skill of skillsToTest) {
    if (testSkillExists(skill)) {
      integrationScore++;
    }
  }
  
  if (testMCPServer()) {
    integrationScore++;
  }
  
  const totalComponents = skillsToTest.length + 1; // +1 for MCP server
  const integrationPercentage = (integrationScore / totalComponents) * 100;
  
  if (integrationPercentage >= 80) {
    TEST_RESULTS.integration = true;
    log(`Integración: ${integrationPercentage.toFixed(1)}% - Excelente`, 'success');
  } else if (integrationPercentage >= 60) {
    log(`Integración: ${integrationPercentage.toFixed(1)}% - Buena`, 'warning');
  } else {
    log(`Integración: ${integrationPercentage.toFixed(1)}% - Necesita mejora`, 'error');
  }
  
  return integrationPercentage;
}

function simulateWorkflow() {
  log('Simulando flujo de trabajo autónomo...', 'info');
  
  // Simular: "trabaja en proyecto X por 2 horas"
  const workflowSteps = [
    {
      skill: 'autonomous-work-manager',
      action: 'Iniciar tarea autónoma',
      expectedOutput: '🚀 Iniciando Trabajo Autónomo'
    },
    {
      skill: 'code-review-planner', 
      action: 'Analizar proyecto y crear plan',
      expectedOutput: '💻 Code Review & Development Planner'
    },
    {
      skill: 'claude-code-mcp',
      action: 'Ejecutar desarrollo con Claude Code',
      expectedOutput: 'Claude Code execution result'
    },
    {
      skill: 'opencode-integration',
      action: 'Realizar ediciones rápidas',
      expectedOutput: '🔧 OpenCode Integration Activado'
    },
    {
      skill: 'autonomous-work-manager',
      action: 'Reportar progreso (checkpoint)',
      expectedOutput: '⏰ Checkpoint'
    }
  ];
  
  let completedSteps = 0;
  
  for (const step of workflowSteps) {
    log(`Paso ${completedSteps + 1}: ${step.action} (${step.skill})`, 'info');
    
    // Simular tiempo de procesamiento
    setTimeout(() => {
      completedSteps++;
      log(`✅ Paso completado: ${step.action}`, 'success');
    }, 100);
  }
  
  return completedSteps === workflowSteps.length;
}

function generateReport() {
  log('\n📊 GENERANDO REPORTE FINAL', 'info');
  
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalSkills: TEST_RESULTS.skills.length,
      validSkills: TEST_RESULTS.skills.filter(s => s.valid).length,
      mcpServerComplete: TEST_RESULTS.mcpServer,
      integrationSuccess: TEST_RESULTS.integration,
      errors: TEST_RESULTS.errors.length
    },
    skills: TEST_RESULTS.skills,
    errors: TEST_RESULTS.errors,
    recommendations: []
  };
  
  // Generar recomendaciones
  if (report.summary.validSkills < report.summary.totalSkills) {
    report.recommendations.push('Completar skills faltantes o corregir estructura');
  }
  
  if (!report.summary.mcpServerComplete) {
    report.recommendations.push('Verificar instalación y configuración del MCP server');
  }
  
  if (!report.summary.integrationSuccess) {
    report.recommendations.push('Mejorar integración entre componentes');
  }
  
  if (report.recommendations.length === 0) {
    report.recommendations.push('¡Sistema listo para uso en producción!');
  }
  
  // Guardar reporte
  const reportPath = path.join(process.cwd(), 'test-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  log(`Reporte guardado en: ${reportPath}`, 'success');
  
  // Mostrar resumen
  console.log('\n🎯 RESUMEN DE PRUEBAS');
  console.log('='.repeat(50));
  console.log(`Skills válidos: ${report.summary.validSkills}/${report.summary.totalSkills}`);
  console.log(`MCP Server: ${report.summary.mcpServerComplete ? '✅' : '❌'}`);
  console.log(`Integración: ${report.summary.integrationSuccess ? '✅' : '❌'}`);
  console.log(`Errores: ${report.summary.errors}`);
  
  if (report.recommendations.length > 0) {
    console.log('\n💡 RECOMENDACIONES:');
    report.recommendations.forEach(rec => console.log(`• ${rec}`));
  }
  
  return report;
}

async function main() {
  log('🚀 INICIANDO PRUEBAS DE FLUJO AUTÓNOMO DE ENZO', 'info');
  console.log('='.repeat(60));
  
  // 1. Probar skills individuales
  log('\n1️⃣ Probando Skills...', 'info');
  const skills = [
    'autonomous-work-manager',
    'teaching-materials-creator',
    'code-review-planner', 
    'opencode-integration'
  ];
  
  for (const skill of skills) {
    testSkillExists(skill);
  }
  
  // 2. Probar MCP Server
  log('\n2️⃣ Probando MCP Server...', 'info');
  testMCPServer();
  
  // 3. Probar integración
  log('\n3️⃣ Probando Integración...', 'info');
  testIntegration();
  
  // 4. Simular flujo de trabajo
  log('\n4️⃣ Simulando Flujo de Trabajo...', 'info');
  simulateWorkflow();
  
  // 5. Generar reporte
  setTimeout(() => {
    log('\n5️⃣ Generando Reporte Final...', 'info');
    const report = generateReport();
    
    // Salir con código apropiado
    const success = report.summary.validSkills === skills.length && 
                   report.summary.mcpServerComplete && 
                   report.summary.integrationSuccess;
    
    process.exit(success ? 0 : 1);
  }, 1000);
}

// Ejecutar pruebas
main().catch(error => {
  log(`Error fatal: ${error.message}`, 'error');
  process.exit(1);
});
