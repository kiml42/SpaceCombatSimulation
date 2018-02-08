using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public class Evolution1v1Config : BaseEvolutionConfig
    {

        public float SuddenDeathDamage = 20;

        /// <summary>
        /// Time for repeating the sudden death damage.
        /// Also used as the minimum score for winning a match.
        /// </summary>
        public float SuddenDeathReloadTime = 2;
    }
}
