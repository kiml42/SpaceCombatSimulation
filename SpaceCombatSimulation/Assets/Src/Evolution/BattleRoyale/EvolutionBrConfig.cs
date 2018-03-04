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
        public int NumberOfCombatants = 2;
    }
}
