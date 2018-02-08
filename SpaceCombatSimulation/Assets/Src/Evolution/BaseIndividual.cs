namespace Assets.Src.Evolution
{
    public abstract class BaseIndividual
    {
        public string Genome { get
            {
                return Summary.Genome;
            }
        }
        public SeciesSummary Summary { get; private set; }

        public float Score { get; set; }

        /// <summary>
        /// creates an incomplete individual (before the configuration has been run)
        /// Run Finalise() once the individual has been configured.
        /// </summary>
        /// <param name="genome"></param>
        public BaseIndividual(string genome)
        {
            Summary = new SeciesSummary(genome);
        }

        /// <summary>
        /// Updates this individual's summary with the data from the finished genome wrapper (after all configuration has been completed)
        /// </summary>
        /// <param name="genomeWrapper">GenomeWrapper that has been used to configure the individual</param>
        public void Finalise(GenomeWrapper genomeWrapper)
        {
            Summary = new SeciesSummary(genomeWrapper);
        }
    }
}