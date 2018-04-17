using Assets.Src.Evolution;
using Assets.Src.ModuleSystem;
using System;
using UnityEngine;

public class FuelTank : GeneticConfigurableMonobehaviour
{
    public float Fuel;

    public bool UseFuelMass = false;
    /// <summary>
    /// Mass will be added to the Rigidbody(if present) = to FuelDensity * Fuel.
    /// 1gram per unit by default.
    /// </summary>
    [Tooltip("In kg per unit")]
    public float FuelDensity = 0.001f;

    private float _originalMass;
    private Rigidbody _rigidbody;

    public void Start()
    {
        if (UseFuelMass)
        {
            _rigidbody = GetComponent<Rigidbody>();
            _originalMass = _rigidbody.mass;
            SetMassIncludingFuel();
        }
    }

    public float DrainFuel(float requestedFuel)
    {
        if(HasFuel())
        {
            var fuelToReturn = Math.Min(requestedFuel, Fuel);
            Fuel -= fuelToReturn;
            if (UseFuelMass)
            {
                SetMassIncludingFuel();
            }
            return fuelToReturn;
        }
        return 0;
    }

    public bool HasFuel()
    {
        return Fuel > 0;
    }

    private void SetMassIncludingFuel()
    {
        _rigidbody.mass = _originalMass + Fuel * FuelDensity;
    }
    
    protected override GenomeWrapper SubConfigure(GenomeWrapper genomeWrapper)
    {
        Fuel = genomeWrapper.GetScaledNumber(Fuel, 0, 0.9f);
        return genomeWrapper;
    }
}
