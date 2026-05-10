export interface UserPreferences {
  verbosity: {
    explainClassification: boolean;
    showSkillsConsidered: boolean;
    showMCPsConsidered: boolean;
    announceDecomposition: boolean;
  };

  requireConfirmation: {
    beforeDelegation: boolean;
    beforeComplexDecomposition: boolean;
    beforeMCPCall: boolean;
  };

  execution: {
    preferSkillsOverMCPs: boolean;
    maxIterations: number;
    enableLearning: boolean;
  };
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  verbosity: {
    explainClassification: false,
    showSkillsConsidered: false,
    showMCPsConsidered: false,
    announceDecomposition: true,
  },
  requireConfirmation: {
    beforeDelegation: false,
    beforeComplexDecomposition: false,
    beforeMCPCall: false,
  },
  execution: {
    preferSkillsOverMCPs: false,
    maxIterations: 8,
    enableLearning: true,
  },
};

export type UserPreferencesKey = keyof UserPreferences;
export type VerbosityKey = keyof UserPreferences['verbosity'];
export type ConfirmationKey = keyof UserPreferences['requireConfirmation'];
export type ExecutionKey = keyof UserPreferences['execution'];

export const PROFILE_PRESETS: Record<string, UserPreferences> = {
  silent: {
    verbosity: {
      explainClassification: false,
      showSkillsConsidered: false,
      showMCPsConsidered: false,
      announceDecomposition: false,
    },
    requireConfirmation: {
      beforeDelegation: false,
      beforeComplexDecomposition: false,
      beforeMCPCall: false,
    },
    execution: {
      preferSkillsOverMCPs: false,
      maxIterations: 8,
      enableLearning: true,
    },
  },
  informative: {
    verbosity: {
      explainClassification: true,
      showSkillsConsidered: true,
      showMCPsConsidered: true,
      announceDecomposition: true,
    },
    requireConfirmation: {
      beforeDelegation: false,
      beforeComplexDecomposition: false,
      beforeMCPCall: false,
    },
    execution: {
      preferSkillsOverMCPs: false,
      maxIterations: 8,
      enableLearning: true,
    },
  },
  control: {
    verbosity: {
      explainClassification: true,
      showSkillsConsidered: true,
      showMCPsConsidered: true,
      announceDecomposition: true,
    },
    requireConfirmation: {
      beforeDelegation: true,
      beforeComplexDecomposition: true,
      beforeMCPCall: true,
    },
    execution: {
      preferSkillsOverMCPs: false,
      maxIterations: 8,
      enableLearning: true,
    },
  },
};

export function mergePreferences(
  base: UserPreferences,
  updates: Partial<UserPreferences>
): UserPreferences {
  const result = { ...base };

  if (updates.verbosity) {
    result.verbosity = { ...base.verbosity, ...updates.verbosity };
  }
  if (updates.requireConfirmation) {
    result.requireConfirmation = { ...base.requireConfirmation, ...updates.requireConfirmation };
  }
  if (updates.execution) {
    result.execution = { ...base.execution, ...updates.execution };
  }

  return result;
}

export function validatePreferences(prefs: unknown): prefs is UserPreferences {
  if (!prefs || typeof prefs !== 'object') return false;

  const p = prefs as Record<string, unknown>;

  if (typeof p.verbosity !== 'object' || p.verbosity === null) return false;
  if (typeof p.requireConfirmation !== 'object' || p.requireConfirmation === null) return false;
  if (typeof p.execution !== 'object' || p.execution === null) return false;

  const v = p.verbosity as Record<string, unknown>;
  const rc = p.requireConfirmation as Record<string, unknown>;
  const e = p.execution as Record<string, unknown>;

  if (typeof v.explainClassification !== 'boolean') return false;
  if (typeof v.showSkillsConsidered !== 'boolean') return false;
  if (typeof v.showMCPsConsidered !== 'boolean') return false;
  if (typeof v.announceDecomposition !== 'boolean') return false;

  if (typeof rc.beforeDelegation !== 'boolean') return false;
  if (typeof rc.beforeComplexDecomposition !== 'boolean') return false;
  if (typeof rc.beforeMCPCall !== 'boolean') return false;

  if (typeof e.preferSkillsOverMCPs !== 'boolean') return false;
  if (typeof e.maxIterations !== 'number' || e.maxIterations < 1 || e.maxIterations > 20) return false;
  if (typeof e.enableLearning !== 'boolean') return false;

  return true;
}