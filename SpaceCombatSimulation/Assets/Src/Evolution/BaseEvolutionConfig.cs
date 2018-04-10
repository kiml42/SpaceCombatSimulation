namespace Assets.Src.Evolution
{
    public abstract class BaseEvolutionConfig
    {
        public int DatabaseId;

        public string RunName;

        public int GenerationNumber;
        
        /// <summary>
        /// The generation is over when every individual has had at least this many matches.
        /// </summary>
        public int MinMatchesPerIndividual = 3;

        /// <summary>
        /// The number of individuals to keep for the next generation
        /// </summary>
        public int WinnersFromEachGeneration = 5;

        public MutationConfig MutationConfig = new MutationConfig();
        public MatchConfig MatchConfig = new MatchConfig();
    }
}