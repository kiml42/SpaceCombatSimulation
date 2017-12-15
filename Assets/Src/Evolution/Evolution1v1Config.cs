using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Evolution
{
    public class Evolution1v1Config
    {
        public int DatabaseId;

        public string RunName;
        
        public MutationConfig MutationControl = new MutationConfig();
        public MatchConfig MatchConfig = new MatchConfig();
        
        /// <summary>
        /// The generation is over when every individual has had at least this many matches.
        /// </summary>
        public int MinMatchesPerIndividual = 3;

        /// <summary>
        /// The number of individuals to keep for the next generation
        /// </summary>
        public int WinnersFromEachGeneration = 3;
        
        public int GenerationNumber;

        public float SuddenDeathDamage = 10;

        /// <summary>
        /// Time for repeating the sudden death damage.
        /// Also used as the minimum score for winning a match.
        /// </summary>
        public float SuddenDeathReloadTime = 200;

    }
}
