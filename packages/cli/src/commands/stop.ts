import chalk from 'chalk';

export async function stop(): Promise<void> {
  try {
    console.log('\n');
    console.log(chalk.yellow('⏹️  Stop manual por terminal\n'));
    console.log(chalk.white('Este comando no mata procesos en background automáticamente.'));
    console.log(chalk.white('Para detener Enzo, usa Ctrl+C en cada terminal donde lo iniciaste.'));
    console.log(chalk.gray('• Si usaste "pnpm dev", detén esa terminal.'));
    console.log(chalk.gray('• Si usaste "./enzo start", detén esa terminal.\n'));
  } catch (error) {
    console.log('\n');
    console.log(chalk.red(`❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    console.log('\n');
    process.exit(1);
  }
}
