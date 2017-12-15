using Assets.src.Evolution;
using Assets.Src.Evolution;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EvolutionMutationController : MonoBehaviour {
    public MutationConfig Config = new MutationConfig();    

    private StringMutator _mutator;

    void Start()
    {
        _mutator = new StringMutator
        {
            AllowedCharacters = Config.AllowedCharacters,
            GenomeLength = Config.GenomeLength,
            MaxMutationLength = Config.MaxMutationLength,
            Mutations = Config.Mutations
        };
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
