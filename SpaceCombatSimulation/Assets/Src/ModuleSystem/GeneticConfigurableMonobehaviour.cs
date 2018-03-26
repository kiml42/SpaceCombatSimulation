using Assets.Src.Evolution;
using Assets.Src.Interfaces;
using UnityEngine;

namespace Assets.Src.ModuleSystem
{
    public abstract class GeneticConfigurableMonobehaviour : MonoBehaviour, IGeneticConfigurable
    {
        public bool GetConfigFromGenome = true;

        [Tooltip("The index in the genome at which the configuration for this MonoBehaviour starts.")]
        public int ConfigIndex = -1;
        public GenomeWrapper Configure(GenomeWrapper genomeWrapper)
        {
            if (GetConfigFromGenome)
            {
                ConfigIndex = genomeWrapper.Position;

                return SubConfigure(genomeWrapper);
            } else
            {
                ConfigIndex = -1;
                return genomeWrapper;
            }
        }

        protected abstract GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper);
    }
}
