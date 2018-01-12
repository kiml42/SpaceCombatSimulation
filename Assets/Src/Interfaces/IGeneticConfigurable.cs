using Assets.Src.Evolution;

namespace Assets.Src.Interfaces
{
    public interface IGeneticConfigurable
    {
        /// <summary>
        /// Configures the component using the genome wrapper provided
        /// </summary>
        /// <param name="genomeWrapper"></param>
        /// <returns>the genomewrapper with variables altered by the parts that have been used.</returns>
        GenomeWrapper Configure(GenomeWrapper genomeWrapper);
    }
}
