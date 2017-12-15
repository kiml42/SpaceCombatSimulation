using Assets.src.Evolution;
using Assets.Src.Evolution;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EvolutionMutationWrapper {
    private MutationConfig _config = new MutationConfig();    
    private StringMutator _mutator;
    
    public MutationConfig Config { get
        {
            return _config;
        }
        set
        {
            _config = value;
            _mutator.Config = value;
        }
    }

    public EvolutionMutationWrapper()
    {
        _mutator = new StringMutator(Config);
    }


    public List<string> CreateGenerationOfMutants(List<string> baseGenomes)
    {
        return _mutator.CreateGenerationOfMutants(baseGenomes, Config.GenerationSize);
    }

    public List<string> CreateDefaultGeneration()
    {
        var defaultGenomes = Config.UseCompletelyRandomDefaultGenome ? null : new List<string> { Config.DefaultGenome };
        return CreateGenerationOfMutants(defaultGenomes);
    }

    public string CreateSingleMutant(string original)
    {
        return _mutator.Mutate(original);
    }
}
