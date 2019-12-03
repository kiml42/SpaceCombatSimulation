using UnityEngine.UI;

namespace Assets.Src.Evolution
{
    public class EditGeneralEvolutionConfigController : EditBaseConfig
    {
        public InputField RunName;
        protected int _generationNumber;
        public InputField MinMatchesPerIndividual;
        public InputField WinnersFromEachGeneration;

        private EvolutionConfig _loaded;
        
        public EvolutionConfig ReadControls()
        {
            _loaded.RunName = RunName.text;
            _loaded.MinMatchesPerIndividual = int.Parse(MinMatchesPerIndividual.text);
            _loaded.WinnersFromEachGeneration = int.Parse(WinnersFromEachGeneration.text);
            _loaded.GenerationNumber = _generationNumber;

            return _loaded;
        }

        public override void PopulateControls(EvolutionConfig config)
        {
            _loaded = config;
            RunName.text = _loaded.RunName;
            MinMatchesPerIndividual.text = _loaded.MinMatchesPerIndividual.ToString();
            WinnersFromEachGeneration.text = _loaded.WinnersFromEachGeneration.ToString();

            _generationNumber = _loaded.GenerationNumber;
        }
    }

}