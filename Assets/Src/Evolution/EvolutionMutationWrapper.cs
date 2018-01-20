using Assets.src.Evolution;
using Assets.Src.Evolution;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;

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
        var defaultGenomes = Config.UseCompletelyRandomDefaultGenome ? null : new List<string> { PadGenome( Config.DefaultGenome ) };
        return CreateGenerationOfMutants(defaultGenomes);
    }

    private string PadGenome(string genome)
    {
        while(genome.Length < _config.GenomeLength)
        {
            genome = genome + genome;
        }
        return genome.Substring(0, _config.GenomeLength);
    }

    public string CreateSingleMutant(string original)
    {
        return _mutator.Mutate(original);
    }
}
