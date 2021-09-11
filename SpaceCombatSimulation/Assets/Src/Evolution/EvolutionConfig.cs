using Assets.Src.Evolution.BattleRoyale;
using Assets.Src.Evolution.Drone;
using Assets.Src.Evolution.Race;

namespace Assets.Src.Evolution
{
    public class EvolutionConfig
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
        public EvolutionBrConfig BrConfig = new EvolutionBrConfig();
        public EvolutionRaceConfig RaceConfig = new EvolutionRaceConfig();
        public EvolutionDroneConfig EvolutionDroneConfig = new EvolutionDroneConfig();
    }
}
