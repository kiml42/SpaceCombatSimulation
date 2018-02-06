namespace Assets.Src.Evolution
{
    public class BaseIndividual
    {
        public string Genome;

        public object Species { get; set; }
        public string Subspecies { get; set; }

        public float Score;

        public void SetSpieciesNames(GenomeWrapper a)
        {
            Species = a.Species;
            Subspecies = a.Subspecies;
        }
    }
}