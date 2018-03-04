using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public class EvolutionBrConfig : BaseEvolutionConfig
    {

        public float SuddenDeathDamage = 20;

        /// <summary>
        /// Time for repeating the sudden death damage.
        /// Also used as the minimum score for winning a match.
        /// </summary>
        public float SuddenDeathReloadTime = 2;

        public const int MAX_COMBATANTS = 6;
        public const int MIN_COMBATANTS = 2;

        private int _numberOfCombatants = 2;
        public int NumberOfCombatants {
            get {
                return Math.Max(
                    MIN_COMBATANTS,
                    Math.Min(
                        MAX_COMBATANTS, _numberOfCombatants
                    )
                );
            }
            set
            {
                _numberOfCombatants = value;
            }
        }
    }
}
