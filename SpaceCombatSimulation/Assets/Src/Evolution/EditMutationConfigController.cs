using UnityEngine.UI;

namespace Assets.Src.Evolution
{
    public class EditMutationConfigController : EditBaseConfig
    {
        public InputField Mutations;

        public InputField AllowedCharacters;

        public InputField MaxMutationLength;

        public InputField GenomeLength;

        public InputField GenerationSize;

        public InputField UseCompletelyRandomDefaultGenome;

        public InputField DefaultGenome;

        private MutationConfig _loaded;

        public override void PopulateControls(EvolutionConfig config)
        {
            _loaded = config.MutationConfig;

            Mutations.text = _loaded.Mutations.ToString();
            MaxMutationLength.text = _loaded.MaxMutationLength.ToString();
            GenomeLength.text = _loaded.GenomeLength.ToString();
            GenerationSize.text = _loaded.GenerationSize.ToString();
            UseCompletelyRandomDefaultGenome.text = _loaded.UseCompletelyRandomDefaultGenome.ToString();
            DefaultGenome.text = _loaded.DefaultGenome.ToString();
        }

        public MutationConfig ReadControls()
        {
            _loaded = _loaded ?? new MutationConfig();

            _loaded.Mutations = int.Parse(Mutations.text);
            _loaded.MaxMutationLength = int.Parse(MaxMutationLength.text);
            _loaded.GenomeLength = int.Parse(GenomeLength.text);
            _loaded.GenerationSize = int.Parse(GenerationSize.text);
            _loaded.UseCompletelyRandomDefaultGenome = bool.Parse(UseCompletelyRandomDefaultGenome.text);
            _loaded.DefaultGenome = DefaultGenome.text;

            return _loaded;
        }
    }
}
